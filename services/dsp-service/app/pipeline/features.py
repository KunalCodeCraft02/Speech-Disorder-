"""Session-level running statistics and the full feature-set computation.

Two different accumulation strategies are used deliberately:

- Rate features that drive real-time classification (articulation rate,
  speech rate) are computed over a bounded trailing window, so they react
  quickly to a change in how the person is currently speaking.
- Descriptive rhythm features (pause stats, IPU length, voice activity%,
  speech consistency) accumulate over the whole session as O(1) running
  scalars — no unbounded lists, so memory stays flat no matter how long a
  session runs — since these are more meaningful, and more stable, as a
  session-to-date picture than a 4-second snapshot.
- Pitch and loudness are recomputed fresh each pass over the trailing
  window, since they describe the speaker's *current* physiological state.
- `wordsPerLast30Sec` uses a third, independent accumulation window (a
  trailing 30s ring buffer of nuclei, kept separate from the 4s
  classification window) so it updates on its own cadence rather than
  being tied to ANALYSIS_WINDOW_SEC.

`rateTrend`, `meanPitchTrendHz`, `timeInAbnormalStateSec` and
`recoveryTimeSec` are NOT computed here — they depend on cross-window
history and (for the latter two) the classifier's confirmed state, which
isn't known until after this module runs. Those live in
session_pipeline.py, which has both the window history and the
classification result available.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

from app.pipeline import constants as C
from app.pipeline.baseline import BaselineProfile
from app.pipeline.pitch import PitchFrame, voiced_f0_array
from app.pipeline.segmentation import Segment, SegmentKind
from app.pipeline.vad import FrameDecision


@dataclass
class FeatureSet:
    elapsed_sec: float
    articulation_rate_sps: float
    speech_rate_wpm: float
    average_syllable_duration_sec: float | None
    inter_syllable_interval_sec: float | None
    pause_duration_sec: float | None
    pause_frequency_per_min: float
    speech_to_pause_ratio: float | None
    inter_pausal_unit_length_sec: float | None
    mean_pitch_hz: float | None
    pitch_variability_hz: float | None
    loudness_db: float
    voice_activity_percent: float
    speech_consistency: float
    composite_score: float
    words_per_last_30_sec: float
    total_syllables_session: int
    total_words_session: float
    loudness_variability_db: float


class RunningStats:
    """O(1)-memory accumulator for one session. `recent_*` deques are kept
    trimmed to the rolling analysis window and are the only unbounded-looking
    structures here — in practice they hold at most a few dozen entries.
    `recent_nuclei_times_30s` is the exception: it's trimmed to a fixed 30s
    instead of the (shorter) classification window, for `wordsPerLast30Sec`."""

    def __init__(self) -> None:
        self.total_pause_count = 0
        self.total_pause_sec = 0.0
        self.total_ipu_count = 0
        self.total_ipu_sec = 0.0
        self.total_nuclei_count = 0

        self._sum_isi = 0.0
        self._sumsq_isi = 0.0
        self._count_isi = 0
        self._last_nucleus_time: float | None = None
        self._last_nucleus_pause_stamp = 0

        self.recent_nuclei_times: deque[float] = deque()
        self.recent_nuclei_times_30s: deque[float] = deque()
        self.recent_frame_decisions: deque[FrameDecision] = deque()
        self.recent_segments: deque[Segment] = deque()

    def add_segments(self, segments: list[Segment], window_sec: float, current_time: float) -> None:
        for seg in segments:
            if seg.kind == SegmentKind.SPEECH:
                self.total_ipu_count += 1
                self.total_ipu_sec += seg.duration
            else:
                self.total_pause_count += 1
                self.total_pause_sec += seg.duration
            self.recent_segments.append(seg)

        cutoff = current_time - window_sec
        while self.recent_segments and self.recent_segments[0].end < cutoff:
            self.recent_segments.popleft()

    def add_frame_decisions(self, decisions: list[FrameDecision], window_sec: float) -> None:
        if not decisions:
            return
        self.recent_frame_decisions.extend(decisions)
        cutoff = decisions[-1].time - window_sec
        while self.recent_frame_decisions and self.recent_frame_decisions[0].time < cutoff:
            self.recent_frame_decisions.popleft()

    def add_nuclei(self, nuclei_times: list[float], window_sec: float, current_time: float) -> None:
        for t in nuclei_times:
            self.total_nuclei_count += 1

            if self._last_nucleus_time is not None and self._last_nucleus_pause_stamp == self.total_pause_count:
                gap = t - self._last_nucleus_time
                if gap > 0:
                    self._sum_isi += gap
                    self._sumsq_isi += gap * gap
                    self._count_isi += 1

            self._last_nucleus_time = t
            self._last_nucleus_pause_stamp = self.total_pause_count
            self.recent_nuclei_times.append(t)
            self.recent_nuclei_times_30s.append(t)

        cutoff = current_time - window_sec
        while self.recent_nuclei_times and self.recent_nuclei_times[0] < cutoff:
            self.recent_nuclei_times.popleft()

        cutoff_30s = current_time - C.WORDS_RING_BUFFER_SEC
        while self.recent_nuclei_times_30s and self.recent_nuclei_times_30s[0] < cutoff_30s:
            self.recent_nuclei_times_30s.popleft()

    # --- derived, windowed ---

    def windowed_nuclei_count(self) -> int:
        return len(self.recent_nuclei_times)

    def words_per_last_30_sec(self) -> float:
        return len(self.recent_nuclei_times_30s) / C.SYLLABLES_PER_WORD

    def windowed_phonation_sec(
        self,
        window_start: float,
        window_end: float,
        open_kind: SegmentKind,
        open_start: float,
        open_end: float,
    ) -> float:
        """Phonation time within [window_start, window_end], using the
        segmenter's *merged* IPU/pause boundaries rather than raw per-frame
        VAD flags — a brief sub-min-pause dip inside an utterance is
        phonation time here exactly as it is in `total_ipu_sec`, keeping the
        two consistent (see module docstring)."""
        total = 0.0

        for seg in self.recent_segments:
            if seg.kind != SegmentKind.SPEECH:
                continue
            overlap = min(seg.end, window_end) - max(seg.start, window_start)
            if overlap > 0:
                total += overlap

        if open_kind == SegmentKind.SPEECH:
            overlap = min(open_end, window_end) - max(open_start, window_start)
            if overlap > 0:
                total += overlap

        return total

    def windowed_loudness_db(self) -> float:
        speech_energies = [d.energy_db for d in self.recent_frame_decisions if d.is_speech]
        if speech_energies:
            return float(np.mean(speech_energies))
        all_energies = [d.energy_db for d in self.recent_frame_decisions]
        return float(np.mean(all_energies)) if all_energies else -60.0

    def windowed_loudness_std_db(self) -> float:
        speech_energies = [d.energy_db for d in self.recent_frame_decisions if d.is_speech]
        return float(np.std(speech_energies)) if len(speech_energies) >= 2 else 0.0

    # --- derived, session-to-date ---

    def mean_isi(self) -> float | None:
        return (self._sum_isi / self._count_isi) if self._count_isi > 0 else None

    def isi_coefficient_of_variation(self) -> float | None:
        if self._count_isi < 2:
            return None
        mean = self._sum_isi / self._count_isi
        variance = max(0.0, self._sumsq_isi / self._count_isi - mean * mean)
        std = variance**0.5
        return (std / mean) if mean > C.EPS else None

    def mean_ipu_sec(self) -> float | None:
        return (self.total_ipu_sec / self.total_ipu_count) if self.total_ipu_count > 0 else None

    def mean_pause_sec(self) -> float | None:
        return (self.total_pause_sec / self.total_pause_count) if self.total_pause_count > 0 else None

    def pause_frequency_per_min(self, elapsed_sec: float) -> float:
        minutes = elapsed_sec / 60.0
        return (self.total_pause_count / minutes) if minutes > C.EPS else 0.0

    def voice_activity_percent(self, open_kind: SegmentKind, open_duration: float, elapsed_sec: float) -> float:
        speech_sec = self.total_ipu_sec + (open_duration if open_kind == SegmentKind.SPEECH else 0.0)
        return 100.0 * speech_sec / elapsed_sec if elapsed_sec > C.EPS else 0.0

    def speech_to_pause_ratio(self, open_kind: SegmentKind, open_duration: float) -> float | None:
        speech_sec = self.total_ipu_sec + (open_duration if open_kind == SegmentKind.SPEECH else 0.0)
        pause_sec = self.total_pause_sec + (open_duration if open_kind == SegmentKind.PAUSE else 0.0)
        return (speech_sec / pause_sec) if pause_sec > C.EPS else None


def _consistency_from_cv(cv: float | None) -> float:
    if cv is None:
        return 1.0  # not enough same-IPU nuclei pairs yet — don't report spurious low consistency
    return float(np.clip(1.0 - cv, 0.0, 1.0))


def _composite_score(
    articulation_rate: float,
    baseline_rate: float,
    consistency: float,
    voice_activity_ratio: float,
) -> float:
    if baseline_rate > C.EPS:
        rate_closeness = 1.0 - min(1.0, abs(articulation_rate - baseline_rate) / baseline_rate)
    else:
        rate_closeness = 0.5

    activity_gap = abs(voice_activity_ratio - C.COMPOSITE_TARGET_VOICE_ACTIVITY) / C.COMPOSITE_TARGET_VOICE_ACTIVITY
    activity_score = 1.0 - min(1.0, activity_gap)

    score = (
        C.COMPOSITE_WEIGHT_RATE * rate_closeness
        + C.COMPOSITE_WEIGHT_CONSISTENCY * consistency
        + C.COMPOSITE_WEIGHT_ACTIVITY * activity_score
    )
    return float(np.clip(score * 100.0, 0.0, 100.0))


def linear_slope(points: list[tuple[float, float]]) -> float | None:
    """Least-squares slope of `y` over `x` for (x, y) points — used for
    rateTrend / meanPitchTrendHz (Part C.10), each computed over the last
    TREND_WINDOW_COUNT analysis windows. Returns None with fewer than 2
    points (no trend can be established yet). `x` is elapsed session time
    in seconds, not a window index, so the slope is robust to windows not
    being perfectly evenly spaced."""
    n = len(points)
    if n < 2:
        return None
    xs = np.asarray([p[0] for p in points], dtype=np.float64)
    ys = np.asarray([p[1] for p in points], dtype=np.float64)
    x_mean = xs.mean()
    y_mean = ys.mean()
    denom = float(np.sum((xs - x_mean) ** 2))
    if denom < C.EPS:
        return 0.0
    return float(np.sum((xs - x_mean) * (ys - y_mean)) / denom)


def compute_feature_set(
    stats: RunningStats,
    *,
    elapsed_sec: float,
    window_start: float,
    window_end: float,
    open_kind: SegmentKind,
    open_start: float,
    open_end: float,
    pitch_frames: list[PitchFrame],
    baseline: BaselineProfile,
) -> FeatureSet:
    window_sec = window_end - window_start
    open_duration = max(0.0, open_end - open_start)
    effective_window = min(window_sec, elapsed_sec) if elapsed_sec > C.EPS else window_sec

    windowed_nuclei = stats.windowed_nuclei_count()
    windowed_phonation = stats.windowed_phonation_sec(window_start, window_end, open_kind, open_start, open_end)

    articulation_rate = (windowed_nuclei / windowed_phonation) if windowed_phonation > C.EPS else 0.0
    speech_rate_sps = (windowed_nuclei / effective_window) if effective_window > C.EPS else 0.0
    speech_rate_wpm = speech_rate_sps * 60.0 / C.SYLLABLES_PER_WORD

    average_syllable_duration = (windowed_phonation / windowed_nuclei) if windowed_nuclei > 0 else None

    voiced_f0 = voiced_f0_array(pitch_frames)
    mean_pitch = float(np.mean(voiced_f0)) if voiced_f0.size > 0 else None
    if voiced_f0.size > 1:
        pitch_variability = float(np.std(voiced_f0))
    elif voiced_f0.size == 1:
        pitch_variability = 0.0
    else:
        pitch_variability = None

    consistency = _consistency_from_cv(stats.isi_coefficient_of_variation())
    voice_activity_pct = stats.voice_activity_percent(open_kind, open_duration, elapsed_sec)

    composite = _composite_score(
        articulation_rate,
        baseline.baseline_articulation_rate,
        consistency,
        voice_activity_pct / 100.0,
    )

    return FeatureSet(
        elapsed_sec=elapsed_sec,
        articulation_rate_sps=articulation_rate,
        speech_rate_wpm=speech_rate_wpm,
        average_syllable_duration_sec=average_syllable_duration,
        inter_syllable_interval_sec=stats.mean_isi(),
        pause_duration_sec=stats.mean_pause_sec(),
        pause_frequency_per_min=stats.pause_frequency_per_min(elapsed_sec),
        speech_to_pause_ratio=stats.speech_to_pause_ratio(open_kind, open_duration),
        inter_pausal_unit_length_sec=stats.mean_ipu_sec(),
        mean_pitch_hz=mean_pitch,
        pitch_variability_hz=pitch_variability,
        loudness_db=stats.windowed_loudness_db(),
        voice_activity_percent=voice_activity_pct,
        speech_consistency=consistency,
        composite_score=composite,
        words_per_last_30_sec=stats.words_per_last_30_sec(),
        total_syllables_session=stats.total_nuclei_count,
        total_words_session=stats.total_nuclei_count / C.SYLLABLES_PER_WORD,
        loudness_variability_db=stats.windowed_loudness_std_db(),
    )
