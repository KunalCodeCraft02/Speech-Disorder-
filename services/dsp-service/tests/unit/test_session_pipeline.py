import pytest

from app.pipeline.features import FeatureSet
from app.pipeline.session_pipeline import (
    SessionPipeline,
    analyze_calibration_clip,
    analyze_reference_sample,
    feature_set_to_json,
)
from tests.conftest import SAMPLE_RATE, build_utterance, float32_to_pcm16_bytes, silence


def silence_chunk(duration_sec: float) -> bytes:
    return float32_to_pcm16_bytes(silence(duration_sec))


class TestFeatureSetToJson:
    def test_rounds_values_and_preserves_none(self):
        fs = FeatureSet(
            elapsed_sec=1.0,
            articulation_rate_sps=4.12345,
            speech_rate_wpm=176.789,
            average_syllable_duration_sec=None,
            inter_syllable_interval_sec=0.12345,
            pause_duration_sec=None,
            pause_frequency_per_min=3.14159,
            speech_to_pause_ratio=None,
            inter_pausal_unit_length_sec=1.23456,
            mean_pitch_hz=None,
            pitch_variability_hz=None,
            loudness_db=-18.987,
            voice_activity_percent=71.456,
            speech_consistency=0.87654,
            composite_score=64.321,
            words_per_last_30_sec=8.6543,
            total_syllables_session=42,
            total_words_session=30.0,
            loudness_variability_db=3.456,
        )
        out = feature_set_to_json(fs)
        assert out["articulationRateSPS"] == 4.123
        assert out["speechRateWPM"] == 176.79
        assert out["averageSyllableDurationSec"] is None
        assert out["pauseDurationSec"] is None
        assert out["meanPitchHz"] is None
        assert out["loudnessDb"] == -18.99
        assert out["voiceActivityPercent"] == 71.5
        assert out["compositeScore"] == 64.3
        assert out["wordsPerLast30Sec"] == 8.65
        assert out["totalSyllablesSession"] == 42
        assert out["totalWordsSession"] == 30.0
        assert out["loudnessVariabilityDb"] == 3.46


class TestSessionPipelineTiming:
    def test_process_chunk_with_no_samples_returns_none(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        assert pipeline.process_chunk(b"") is None

    def test_no_emission_before_warmup(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        # warmup_sec defaults to 1.0 — well under that.
        frame = pipeline.process_chunk(silence_chunk(0.5))
        assert frame is None
        assert pipeline.elapsed_sec == pytest.approx(0.5)

    def test_emits_once_warmup_elapses(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        assert pipeline.process_chunk(silence_chunk(0.5)) is None
        frame = pipeline.process_chunk(silence_chunk(0.6))  # total 1.1s, past warmup
        assert frame is not None
        assert frame["type"] == "metrics"
        assert "articulationRateSPS" in frame
        assert "classification" in frame

    def test_min_emit_interval_throttles_rapid_calls(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        pipeline.process_chunk(silence_chunk(1.1))  # first emission happens here
        immediate = pipeline.process_chunk(silence_chunk(0.01))  # well under min_emit_interval_sec (0.5s)
        assert immediate is None

        later = pipeline.process_chunk(silence_chunk(0.6))  # crosses the 0.5s interval
        assert later is not None

    def test_elapsed_sec_tracks_total_samples_in(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        pipeline.process_chunk(silence_chunk(0.3))
        pipeline.process_chunk(silence_chunk(0.2))
        assert pipeline.elapsed_sec == pytest.approx(0.5, abs=1e-3)


class TestSessionPipelineCalibration:
    def test_uses_provided_calibration_baseline(self):
        calibration = {
            "baselineArticulationRate": 5.0,
            "baselineArticulationRateStd": 0.6,
            "baselinePauseRatio": 1.5,
            "baselinePauseRatioStd": 0.4,
        }
        pipeline = SessionPipeline("s1", calibration=calibration, sample_rate=SAMPLE_RATE)
        assert pipeline.baseline.baseline_articulation_rate == 5.0
        assert pipeline.baseline.is_personal is True
        # Thresholds are always derived from settings multipliers, not
        # trusted from the wire payload (see baseline.py).
        from app.core.config import get_settings

        settings = get_settings()
        assert pipeline.baseline.tachylalia_threshold == pytest.approx(5.0 * settings.tachylalia_multiplier)

    def test_none_calibration_is_uncalibrated_not_default(self):
        # Part A.1: a real (non-demoMode) session with no calibration must
        # never silently get the population default.
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        assert pipeline.baseline is None

    def test_none_calibration_with_demo_mode_uses_population_default(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE, demo_mode=True)
        assert pipeline.baseline is not None
        assert pipeline.baseline.is_personal is False
        assert pipeline.baseline.baseline_articulation_rate > 0

    def test_uncalibrated_session_emits_uncalibrated_classification(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        frame = pipeline.process_chunk(silence_chunk(1.1))
        assert frame["classification"] == "uncalibrated"

    def test_disorder_mode_defaults_to_tachylalia(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        assert pipeline.disorder_mode.value == "tachylalia"

    def test_disorder_mode_threaded_through(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE, disorder_mode="bradylalia")
        assert pipeline.disorder_mode.value == "bradylalia"


class TestSessionPipelineSummary:
    def test_build_summary_has_expected_shape(self):
        pipeline = SessionPipeline("session-xyz", calibration=None, sample_rate=SAMPLE_RATE)
        utterance = build_utterance(n_syllables=4, syllable_sec=0.15, gap_sec=0.15)
        pipeline.process_chunk(float32_to_pcm16_bytes(utterance))

        summary = pipeline.build_summary()
        assert summary["type"] == "summary"
        assert summary["sessionId"] == "session-xyz"
        assert summary["durationSec"] == pytest.approx(pipeline.elapsed_sec, abs=0.01)
        assert isinstance(summary["totalSyllables"], int)
        assert isinstance(summary["totalPauses"], int)
        assert isinstance(summary["totalIpus"], int)
        assert "articulationRateSPS" in summary["finalMetrics"]

    def test_build_summary_before_any_audio_does_not_raise(self):
        pipeline = SessionPipeline("s1", calibration=None, sample_rate=SAMPLE_RATE)
        summary = pipeline.build_summary()
        assert summary["durationSec"] == 0.0
        assert summary["totalSyllables"] == 0


class TestAnalyzeReferenceSample:
    def test_returns_expected_keys_and_ranges(self):
        utterance = build_utterance(n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.1, trailing_silence_sec=0.3)
        result = analyze_reference_sample(utterance, SAMPLE_RATE)

        expected_keys = {
            "articulationRateSPS",
            "pauseRatio",
            "speechRateWPM",
            "meanPitchHz",
            "loudnessDb",
            "pauseDurationSec",
            "speechRatio",
            "durationSec",
            "syllableCount",
        }
        assert expected_keys.issubset(result.keys())
        assert result["durationSec"] == pytest.approx(len(utterance) / SAMPLE_RATE, abs=0.01)
        assert result["syllableCount"] >= 1
        assert result["articulationRateSPS"] >= 0
        assert 0.0 <= result["pauseRatio"] <= 1.0

    def test_pure_silence_falls_back_to_defaults_without_crashing(self):
        result = analyze_reference_sample(silence(1.0), SAMPLE_RATE)
        assert result["syllableCount"] == 0
        assert result["durationSec"] == pytest.approx(1.0)


class TestDebugFrameLogging:
    def test_logs_jsonl_records_when_enabled(self, tmp_path, monkeypatch, reset_settings_cache):
        import json

        monkeypatch.setenv("DEBUG_LOG_FRAMES", "true")
        monkeypatch.setenv("DEBUG_LOG_DIR", str(tmp_path))

        pipeline = SessionPipeline("debug-session", calibration=None, sample_rate=SAMPLE_RATE, demo_mode=True)
        pipeline.process_chunk(silence_chunk(1.1))

        log_path = tmp_path / "debug-session.jsonl"
        assert log_path.exists()
        lines = log_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        record = json.loads(lines[0])
        for key in ("elapsedSec", "articulationRateSPS", "zRate", "zPause", "zSyll", "compositeZ", "rawLabel", "confirmedLabel", "confidence", "sampleSufficient"):
            assert key in record

    def test_no_log_file_when_disabled(self, tmp_path, monkeypatch, reset_settings_cache):
        monkeypatch.setenv("DEBUG_LOG_FRAMES", "false")
        monkeypatch.setenv("DEBUG_LOG_DIR", str(tmp_path))

        pipeline = SessionPipeline("debug-session-2", calibration=None, sample_rate=SAMPLE_RATE, demo_mode=True)
        pipeline.process_chunk(silence_chunk(1.1))

        assert not (tmp_path / "debug-session-2.jsonl").exists()


class TestAnalyzeCalibrationClip:
    def test_returns_phonation_and_descriptive_stats(self):
        utterance = build_utterance(n_syllables=6, syllable_sec=0.15, gap_sec=0.12, leading_silence_sec=0.1, trailing_silence_sec=0.3)
        result = analyze_calibration_clip(utterance, SAMPLE_RATE)
        assert result.duration_sec == pytest.approx(len(utterance) / SAMPLE_RATE, abs=0.01)
        assert result.phonation_sec > 0
        assert result.syllable_count >= 1
        assert "speechRateWPM" in result.descriptive

    def test_pure_silence_yields_no_rate_samples(self):
        result = analyze_calibration_clip(silence(1.0), SAMPLE_RATE)
        assert result.rate_samples == []
        assert result.syllable_count == 0

    def test_sub_window_samples_feed_a_personal_baseline(self, monkeypatch, reset_settings_cache):
        # A small sub-window size against a longer, denser utterance
        # reliably produces >=2 usable sub-window samples so the pooled
        # baseline is personal (exercises the routes.py -> from_subwindow_samples glue).
        monkeypatch.setenv("CALIBRATION_SUBWINDOW_SEC", "1.0")
        utterance = build_utterance(
            n_syllables=30, syllable_sec=0.12, gap_sec=0.1, leading_silence_sec=0.1, trailing_silence_sec=0.3
        )
        result = analyze_calibration_clip(utterance, SAMPLE_RATE)
        assert len(result.rate_samples) >= 2

        from app.pipeline.baseline import BaselineProfile

        baseline = BaselineProfile.from_subwindow_samples(
            result.rate_samples, result.pause_samples, result.syllable_duration_samples, result.ipu_length_samples
        )
        assert baseline.is_personal is True
