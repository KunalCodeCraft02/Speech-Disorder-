"""Per-session orchestrator: owns one session's entire streaming state and
is the only place that wires preprocessing -> VAD -> segmentation -> nuclei
detection -> pitch -> feature extraction -> classification together.

One instance is created per live session (see app/session/registry.py) and
fed raw PCM16 chunks in order via `process_chunk`. It never talks to the
network directly — `app/ws/analyze.py` owns the WebSocket and just forwards
bytes in, JSON dicts out.
"""

from __future__ import annotations

import json
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from app.core.config import get_settings
from app.pipeline import constants as C
from app.pipeline.baseline import BaselineProfile
from app.pipeline.classifier import Classification, ClassificationResult, DisorderMode, HysteresisClassifier
from app.pipeline.features import FeatureSet, RunningStats, compute_feature_set, linear_slope
from app.pipeline.pitch import estimate_pitch_contour, voiced_times_array
from app.pipeline.preprocessing import AudioPreprocessor, pcm16_bytes_to_float32
from app.pipeline.segmentation import SegmentKind, SpeechSegmenter
from app.pipeline.syllables import detect_syllable_nuclei
from app.pipeline.vad import VoiceActivityDetector

_ABNORMAL = (Classification.TACHYLALIA, Classification.BRADYLALIA)


def _round_or_none(value: float | None, ndigits: int) -> float | None:
    return round(value, ndigits) if value is not None else None


def feature_set_to_json(f: FeatureSet) -> dict:
    return {
        "articulationRateSPS": round(f.articulation_rate_sps, 3),
        "speechRateWPM": round(f.speech_rate_wpm, 2),
        "averageSyllableDurationSec": _round_or_none(f.average_syllable_duration_sec, 4),
        "interSyllableIntervalSec": _round_or_none(f.inter_syllable_interval_sec, 4),
        "pauseDurationSec": _round_or_none(f.pause_duration_sec, 3),
        "pauseFrequencyPerMin": round(f.pause_frequency_per_min, 2),
        "speechToPauseRatio": _round_or_none(f.speech_to_pause_ratio, 3),
        "interPausalUnitLengthSec": _round_or_none(f.inter_pausal_unit_length_sec, 3),
        "meanPitchHz": _round_or_none(f.mean_pitch_hz, 1),
        "pitchVariabilityHz": _round_or_none(f.pitch_variability_hz, 2),
        "loudnessDb": round(f.loudness_db, 2),
        "voiceActivityPercent": round(f.voice_activity_percent, 1),
        "speechConsistency": round(f.speech_consistency, 3),
        "compositeScore": round(f.composite_score, 1),
        "wordsPerLast30Sec": round(f.words_per_last_30_sec, 2),
        "totalSyllablesSession": f.total_syllables_session,
        "totalWordsSession": round(f.total_words_session, 2),
        "loudnessVariabilityDb": round(f.loudness_variability_db, 2),
    }


def _log_frame_for_accuracy_eval(session_id: str, elapsed: float, features: FeatureSet, result: ClassificationResult, settings) -> None:
    """Part G.15: append this window's decision inputs/outputs as one JSONL
    record, for later scoring against a clinician-labeled ground-truth CSV
    via scripts/evaluate_accuracy.py. No-op unless DEBUG_LOG_FRAMES is set —
    this is a tuning aid, not something every session pays the I/O cost for."""
    if not settings.debug_log_frames:
        return
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "elapsedSec": round(elapsed, 3),
        "articulationRateSPS": round(features.articulation_rate_sps, 3),
        "zRate": round(result.z_rate, 3),
        "zPause": round(result.z_pause, 3),
        "zSyll": round(result.z_syll, 3),
        "compositeZ": round(result.composite_z, 3),
        "rawLabel": result.raw.value,
        "confirmedLabel": result.classification.value,
        "confidence": round(result.confidence, 3),
        "sampleSufficient": result.sample_sufficient,
    }
    os.makedirs(settings.debug_log_dir, exist_ok=True)
    path = os.path.join(settings.debug_log_dir, f"{session_id}.jsonl")
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def _build_metrics_frame(features: FeatureSet, result: ClassificationResult, trend_fields: dict) -> dict:
    frame = {
        "type": "metrics",
        "ts": datetime.now(timezone.utc).isoformat(),
        "elapsedSec": round(features.elapsed_sec, 2),
        "classification": result.classification.value,
        "confidence": round(result.confidence, 3),
        "triggerFeedback": result.trigger_feedback,
        "feedbackReason": result.feedback_reason.value if result.feedback_reason else None,
        "sampleSufficient": result.sample_sufficient,
        "zRate": round(result.z_rate, 3),
        "zPause": round(result.z_pause, 3),
        "zSyll": round(result.z_syll, 3),
        "compositeZ": round(result.composite_z, 3),
    }
    frame.update(feature_set_to_json(features))
    frame.update(trend_fields)
    return frame


class SessionPipeline:
    def __init__(
        self,
        session_id: str,
        calibration: dict | None,
        sample_rate: int | None = None,
        disorder_mode: str = "tachylalia",
        demo_mode: bool = False,
    ) -> None:
        settings = get_settings()

        self.session_id = session_id
        self.sample_rate = sample_rate or settings.sample_rate
        self.demo_mode = bool(demo_mode)
        try:
            self.disorder_mode = DisorderMode(disorder_mode)
        except ValueError:
            self.disorder_mode = DisorderMode.TACHYLALIA

        # `self.baseline` is what the classifier sees: None means genuinely
        # uncalibrated (Part A.1) — the classifier will only ever emit
        # "uncalibrated" in that state. The population default is only ever
        # substituted in behind demoMode; a real, un-calibrated patient
        # session gets None, never a silent default.
        personal_baseline = BaselineProfile.from_calibration_dict(calibration)
        if personal_baseline is not None:
            self.baseline: BaselineProfile | None = personal_baseline
        elif self.demo_mode:
            self.baseline = BaselineProfile.default(settings)
        else:
            self.baseline = None

        # Purely descriptive features (composite score) still need *some*
        # baseline to compare against even when the session is uncalibrated
        # — falls back to the population default for display purposes only;
        # this is never used for the tachylalia/bradylalia decision itself.
        self._descriptive_baseline = self.baseline or BaselineProfile.default(settings)

        self.preprocessor = AudioPreprocessor(self.sample_rate)
        self.vad = VoiceActivityDetector(self.sample_rate)
        self.segmenter = SpeechSegmenter()
        self.stats = RunningStats()
        self.classifier = HysteresisClassifier(self.disorder_mode, refractory_sec=settings.feedback_refractory_sec)

        self.window_sec = settings.analysis_window_sec
        self.min_emit_interval_sec = settings.min_emit_interval_sec
        self.warmup_sec = settings.warmup_sec

        self._processed_buffer = np.zeros(0, dtype=np.float32)
        self._processed_buffer_start_time = 0.0
        self._total_samples_in = 0
        self._last_emit_time: float | None = None
        self._nuclei_cursor_time = 0.0
        self._windows_analyzed = 0

        # Trend history + abnormal-state/recovery tracking (Part C.10).
        self._rate_history: deque[tuple[float, float]] = deque(maxlen=C.TREND_WINDOW_COUNT)
        self._pitch_history: deque[tuple[float, float]] = deque(maxlen=C.TREND_WINDOW_COUNT)
        self._abnormal_state_start: float | None = None
        self._recovery_pending_since: float | None = None

    @property
    def elapsed_sec(self) -> float:
        return self._total_samples_in / self.sample_rate

    def process_chunk(self, raw_pcm: bytes) -> dict | None:
        samples = pcm16_bytes_to_float32(raw_pcm)
        if samples.size == 0:
            return None

        self._total_samples_in += samples.size
        processed_new = self.preprocessor.process(samples)

        if processed_new.size:
            self._append_processed(processed_new)
            decisions = self.vad.process(processed_new)
            if decisions:
                new_segments = self.segmenter.process(decisions, self.vad.hop_seconds)
                self.stats.add_segments(new_segments, self.window_sec, self.elapsed_sec)
                self.stats.add_frame_decisions(decisions, self.window_sec)

        elapsed = self.elapsed_sec
        if elapsed < self.warmup_sec:
            return None
        if self._last_emit_time is not None and (elapsed - self._last_emit_time) < self.min_emit_interval_sec:
            return None

        frame = self._analyze(elapsed)
        self._last_emit_time = elapsed
        self._windows_analyzed += 1
        return frame

    def _append_processed(self, new_samples: np.ndarray) -> None:
        self._processed_buffer = np.concatenate([self._processed_buffer, new_samples])
        max_len = int((self.window_sec + 1.0) * self.sample_rate)
        if len(self._processed_buffer) > max_len:
            trim = len(self._processed_buffer) - max_len
            self._processed_buffer = self._processed_buffer[trim:]
            self._processed_buffer_start_time += trim / self.sample_rate

    def _trailing_window(self) -> tuple[np.ndarray, float, float]:
        window_samples = int(self.window_sec * self.sample_rate)
        window_start_index = max(0, len(self._processed_buffer) - window_samples)
        audio = self._processed_buffer[window_start_index:]
        start_time = self._processed_buffer_start_time + window_start_index / self.sample_rate
        end_time = self._processed_buffer_start_time + len(self._processed_buffer) / self.sample_rate
        return audio, start_time, end_time

    def _accept_new_nuclei(self, candidate_nuclei: list[float], accept_before: float) -> list[float]:
        """Dedupes nuclei detected in this pass against the cursor left by
        the previous pass. A candidate re-estimated within
        NUCLEI_MIN_INTERVAL_SEC of the cursor is boundary re-detection
        jitter (the same syllable, timed slightly differently now that more
        context is available), not a new syllable - plain `> cursor` isn't
        enough to tell the two apart, since jitter is usually just a few ms
        while even fast speech keeps syllables further apart than that.
        """
        cursor = self._nuclei_cursor_time
        accepted: list[float] = []

        for t in candidate_nuclei:
            if t <= accept_before and t > cursor + C.NUCLEI_MIN_INTERVAL_SEC:
                accepted.append(t)
                cursor = t

        if accepted:
            self._nuclei_cursor_time = cursor
        elif candidate_nuclei:
            self._nuclei_cursor_time = max(self._nuclei_cursor_time, accept_before)

        return accepted

    def _update_trends_and_state(self, features: FeatureSet, result: ClassificationResult, elapsed: float) -> dict:
        self._rate_history.append((elapsed, features.articulation_rate_sps))
        rate_trend = linear_slope(list(self._rate_history))

        if features.mean_pitch_hz is not None:
            self._pitch_history.append((elapsed, features.mean_pitch_hz))
        pitch_trend = linear_slope(list(self._pitch_history))

        if result.classification in _ABNORMAL:
            if self._abnormal_state_start is None:
                self._abnormal_state_start = elapsed
            time_in_abnormal = elapsed - self._abnormal_state_start
        else:
            self._abnormal_state_start = None
            time_in_abnormal = 0.0

        recovery_time: float | None = None
        if result.trigger_feedback:
            self._recovery_pending_since = elapsed
        elif result.classification == Classification.NORMAL and self._recovery_pending_since is not None:
            recovery_time = elapsed - self._recovery_pending_since
            self._recovery_pending_since = None

        return {
            "rateTrend": _round_or_none(rate_trend, 4),
            "meanPitchTrendHz": _round_or_none(pitch_trend, 3),
            "timeInAbnormalStateSec": round(time_in_abnormal, 2),
            "recoveryTimeSec": _round_or_none(recovery_time, 2),
        }

    def _analyze(self, elapsed: float) -> dict:
        window_audio, window_start_time, window_end_time = self._trailing_window()

        pitch_frames = estimate_pitch_contour(window_audio, self.sample_rate, window_start_time)
        voiced_times = voiced_times_array(pitch_frames)

        candidate_nuclei = detect_syllable_nuclei(window_audio, self.sample_rate, window_start_time, voiced_times)

        accept_before = window_end_time - C.NUCLEI_BOUNDARY_GUARD_SEC
        new_nuclei = self._accept_new_nuclei(candidate_nuclei, accept_before)

        self.stats.add_nuclei(new_nuclei, self.window_sec, elapsed)

        open_kind, open_start, open_end = self.segmenter.open_segment_info()

        features = compute_feature_set(
            self.stats,
            elapsed_sec=elapsed,
            window_start=window_start_time,
            window_end=window_end_time,
            open_kind=open_kind,
            open_start=open_start,
            open_end=open_end,
            pitch_frames=pitch_frames,
            baseline=self._descriptive_baseline,
        )

        syllables_in_window = self.stats.windowed_nuclei_count()
        phonation_in_window = self.stats.windowed_phonation_sec(window_start_time, window_end_time, open_kind, open_start, open_end)

        result = self.classifier.update(
            articulation_rate=features.articulation_rate_sps,
            speech_to_pause_ratio=features.speech_to_pause_ratio,
            avg_syllable_duration_sec=features.average_syllable_duration_sec,
            syllables_in_window=syllables_in_window,
            phonation_sec_in_window=phonation_in_window,
            baseline=self.baseline,
            current_time=elapsed,
        )

        trend_fields = self._update_trends_and_state(features, result, elapsed)
        _log_frame_for_accuracy_eval(self.session_id, elapsed, features, result, get_settings())

        return _build_metrics_frame(features, result, trend_fields)

    def build_summary(self) -> dict:
        elapsed = self.elapsed_sec
        window_audio, window_start_time, window_end_time = self._trailing_window()
        pitch_frames = estimate_pitch_contour(window_audio, self.sample_rate, window_start_time) if window_audio.size else []
        open_kind, open_start, open_end = self.segmenter.open_segment_info()

        features = compute_feature_set(
            self.stats,
            elapsed_sec=elapsed,
            window_start=window_start_time,
            window_end=window_end_time,
            open_kind=open_kind,
            open_start=open_start,
            open_end=open_end,
            pitch_frames=pitch_frames,
            baseline=self._descriptive_baseline,
        )

        return {
            "type": "summary",
            "sessionId": self.session_id,
            "durationSec": round(elapsed, 2),
            "windowsAnalyzed": self._windows_analyzed,
            "totalSyllables": self.stats.total_nuclei_count,
            "totalPauses": self.stats.total_pause_count,
            "totalIpus": self.stats.total_ipu_count,
            "finalMetrics": feature_set_to_json(features),
        }


def _analyze_clip(pcm_float: np.ndarray, sample_rate: int, baseline: BaselineProfile) -> tuple[FeatureSet, float, float]:
    """Runs one full, independent pass of preprocess -> VAD -> segment ->
    pitch -> nuclei -> features over `pcm_float`, treated as a single
    self-contained clip with no streaming state carried in or out. Shared by
    `analyze_reference_sample` (whole-clip, legacy single-shot calibration)
    and `analyze_calibration_clip` (both whole-clip and per-sub-window,
    Part A.2) so calibration and live analysis always go through the exact
    same feature pipeline. Returns (features, phonation_sec_in_clip, elapsed_sec).
    """
    preprocessor = AudioPreprocessor(sample_rate)
    vad = VoiceActivityDetector(sample_rate)
    segmenter = SpeechSegmenter()
    stats = RunningStats()

    processed = preprocessor.process(pcm_float)
    elapsed = len(pcm_float) / sample_rate
    pitch_frames: list = []

    if processed.size:
        decisions = vad.process(processed)
        if decisions:
            segments = segmenter.process(decisions, vad.hop_seconds)
            stats.add_segments(segments, window_sec=elapsed + 1.0, current_time=elapsed)
            stats.add_frame_decisions(decisions, window_sec=elapsed + 1.0)

        pitch_frames = estimate_pitch_contour(processed, sample_rate)
        voiced_times = voiced_times_array(pitch_frames)
        nuclei = detect_syllable_nuclei(processed, sample_rate, 0.0, voiced_times)
        stats.add_nuclei(nuclei, window_sec=elapsed + 1.0, current_time=elapsed)

    open_kind, open_start, open_end = segmenter.open_segment_info()

    features = compute_feature_set(
        stats,
        elapsed_sec=elapsed,
        window_start=0.0,
        window_end=elapsed,
        open_kind=open_kind,
        open_start=open_start,
        open_end=open_end,
        pitch_frames=pitch_frames,
        baseline=baseline,
    )

    phonation_sec = stats.windowed_phonation_sec(0.0, elapsed, open_kind, open_start, open_end)
    return features, phonation_sec, elapsed


def analyze_reference_sample(pcm_float: np.ndarray, sample_rate: int) -> dict:
    """Non-streaming, whole-buffer analysis of a "read this passage"
    calibration recording — legacy single-clip path, kept for callers that
    still supply one clip with no sub-window std (see
    `analyze_calibration_clip` for the current Part A.2 flow, which adds
    sub-window sampling for a personal std on top of this same whole-clip
    pass)."""
    settings = get_settings()
    features, phonation_sec, elapsed = _analyze_clip(pcm_float, sample_rate, BaselineProfile.default(settings))

    articulation_rate = features.articulation_rate_sps if phonation_sec > C.EPS else settings.default_baseline_articulation_rate
    pause_sec = max(0.0, elapsed - phonation_sec)
    pause_ratio = (pause_sec / elapsed) if elapsed > C.EPS else settings.default_baseline_pause_ratio
    speech_ratio = features.voice_activity_percent / 100.0

    return {
        "articulationRateSPS": round(articulation_rate, 3),
        "pauseRatio": round(pause_ratio, 3),
        "speechRateWPM": round(features.speech_rate_wpm, 2),
        "meanPitchHz": _round_or_none(features.mean_pitch_hz, 1),
        "loudnessDb": round(features.loudness_db, 2),
        "pauseDurationSec": _round_or_none(features.pause_duration_sec, 3),
        "speechRatio": round(speech_ratio, 3),
        "durationSec": round(elapsed, 2),
        "syllableCount": features.total_syllables_session,
    }


@dataclass(frozen=True)
class CalibrationClipResult:
    """One calibration clip's contribution to a (possibly multi-clip,
    Part A.4) calibration attempt: whole-clip descriptive stats, the
    phonation-time gate input (Part A.3), and the per-4s-sub-window samples
    that feed the personal std (Part A.2)."""

    duration_sec: float
    phonation_sec: float
    syllable_count: int
    rate_samples: list[float] = field(default_factory=list)
    pause_samples: list[float] = field(default_factory=list)
    syllable_duration_samples: list[float] = field(default_factory=list)
    ipu_length_samples: list[float] = field(default_factory=list)
    descriptive: dict = field(default_factory=dict)


def analyze_calibration_clip(pcm_float: np.ndarray, sample_rate: int) -> CalibrationClipResult:
    settings = get_settings()
    default_baseline = BaselineProfile.default(settings)

    whole_features, whole_phonation, elapsed = _analyze_clip(pcm_float, sample_rate, default_baseline)

    sub_len = int(settings.calibration_subwindow_sec * sample_rate)
    rate_samples: list[float] = []
    pause_samples: list[float] = []
    syll_samples: list[float] = []
    ipu_samples: list[float] = []

    if sub_len > 0:
        n_sub = len(pcm_float) // sub_len
        for i in range(n_sub):
            chunk = pcm_float[i * sub_len : (i + 1) * sub_len]
            sub_features, _sub_phonation, _sub_elapsed = _analyze_clip(chunk, sample_rate, default_baseline)
            if sub_features.average_syllable_duration_sec is None:
                # No syllables detected in this sub-window (e.g. leading/
                # trailing silence) — not a usable rate sample, and
                # including it would understate the patient's real spread.
                continue
            rate_samples.append(sub_features.articulation_rate_sps)
            syll_samples.append(sub_features.average_syllable_duration_sec)
            if sub_features.speech_to_pause_ratio is not None:
                pause_samples.append(sub_features.speech_to_pause_ratio)
            if sub_features.inter_pausal_unit_length_sec is not None:
                ipu_samples.append(sub_features.inter_pausal_unit_length_sec)

    pause_sec = max(0.0, elapsed - whole_phonation)
    descriptive = {
        "speechRateWPM": round(whole_features.speech_rate_wpm, 2),
        "meanPitchHz": _round_or_none(whole_features.mean_pitch_hz, 1),
        "loudnessDb": round(whole_features.loudness_db, 2),
        "pauseDurationSec": _round_or_none(whole_features.pause_duration_sec, 3),
        "speechRatio": round(whole_features.voice_activity_percent / 100.0, 3),
        "pauseRatio": round((pause_sec / elapsed) if elapsed > C.EPS else 0.0, 3),
    }

    return CalibrationClipResult(
        duration_sec=elapsed,
        phonation_sec=whole_phonation,
        syllable_count=whole_features.total_syllables_session,
        rate_samples=rate_samples,
        pause_samples=pause_samples,
        syllable_duration_samples=syll_samples,
        ipu_length_samples=ipu_samples,
        descriptive=descriptive,
    )
