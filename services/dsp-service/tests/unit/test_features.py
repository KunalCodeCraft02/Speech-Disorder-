import pytest

from app.pipeline.baseline import BaselineProfile
from app.pipeline.features import RunningStats, _composite_score, _consistency_from_cv, compute_feature_set, linear_slope
from app.pipeline.segmentation import Segment, SegmentKind

BASELINE = BaselineProfile(
    baseline_articulation_rate=4.0,
    baseline_articulation_rate_std=0.5,
    baseline_pause_ratio=1.5,
    baseline_pause_ratio_std=0.4,
    baseline_syllable_duration_sec=0.2,
    baseline_syllable_duration_std=0.03,
    baseline_ipu_length_sec=1.0,
    baseline_ipu_length_std=0.2,
    tachylalia_threshold=5.4,
    bradylalia_threshold=2.6,
    is_personal=True,
)


class TestRunningStatsSegments:
    def test_add_segments_accumulates_totals(self):
        stats = RunningStats()
        stats.add_segments(
            [Segment(SegmentKind.SPEECH, 0.0, 1.0), Segment(SegmentKind.PAUSE, 1.0, 1.4)],
            window_sec=10.0,
            current_time=1.4,
        )
        assert stats.total_ipu_count == 1
        assert stats.total_ipu_sec == pytest.approx(1.0)
        assert stats.total_pause_count == 1
        assert stats.total_pause_sec == pytest.approx(0.4)

    def test_recent_segments_trimmed_outside_window(self):
        stats = RunningStats()
        stats.add_segments([Segment(SegmentKind.SPEECH, 0.0, 1.0)], window_sec=2.0, current_time=1.0)
        # Now well past the window — this segment should be trimmed from `recent_segments`.
        stats.add_segments([Segment(SegmentKind.SPEECH, 10.0, 11.0)], window_sec=2.0, current_time=11.0)
        assert all(s.start >= 10.0 for s in stats.recent_segments)

    def test_mean_ipu_and_pause_sec(self):
        stats = RunningStats()
        stats.add_segments(
            [Segment(SegmentKind.SPEECH, 0.0, 1.0), Segment(SegmentKind.SPEECH, 2.0, 4.0)],
            window_sec=10.0,
            current_time=4.0,
        )
        assert stats.mean_ipu_sec() == pytest.approx(1.5)
        assert stats.mean_pause_sec() is None  # no pause segments yet


class TestRunningStatsNuclei:
    def test_add_nuclei_increments_total_count(self):
        stats = RunningStats()
        stats.add_nuclei([0.1, 0.3, 0.5], window_sec=10.0, current_time=0.5)
        assert stats.total_nuclei_count == 3
        assert stats.windowed_nuclei_count() == 3

    def test_isi_computed_between_consecutive_nuclei(self):
        stats = RunningStats()
        stats.add_nuclei([1.0, 1.2, 1.4], window_sec=10.0, current_time=1.4)
        assert stats.mean_isi() == pytest.approx(0.2)
        assert stats.isi_coefficient_of_variation() == pytest.approx(0.0, abs=1e-9)

    def test_isi_not_counted_across_a_pause_boundary(self):
        stats = RunningStats()
        stats.add_nuclei([1.0], window_sec=10.0, current_time=1.0)
        stats.add_segments([Segment(SegmentKind.PAUSE, 1.0, 1.5)], window_sec=10.0, current_time=1.5)
        stats.add_nuclei([2.0], window_sec=10.0, current_time=2.0)
        # The two nuclei straddle a pause — no ISI pair should be recorded.
        assert stats.mean_isi() is None

    def test_nuclei_trimmed_outside_window(self):
        stats = RunningStats()
        stats.add_nuclei([0.1], window_sec=1.0, current_time=0.1)
        stats.add_nuclei([5.0], window_sec=1.0, current_time=5.0)
        assert list(stats.recent_nuclei_times) == [5.0]

    def test_isi_coefficient_of_variation_needs_at_least_two_pairs(self):
        stats = RunningStats()
        stats.add_nuclei([1.0, 1.2], window_sec=10.0, current_time=1.2)
        assert stats.isi_coefficient_of_variation() is None  # only 1 ISI pair so far


class TestRunningStatsDerivedMetrics:
    def test_windowed_phonation_sec_sums_overlap_with_window(self):
        stats = RunningStats()
        stats.add_segments([Segment(SegmentKind.SPEECH, 0.0, 2.0)], window_sec=10.0, current_time=2.0)
        phonation = stats.windowed_phonation_sec(1.0, 3.0, SegmentKind.PAUSE, 2.0, 2.0)
        assert phonation == pytest.approx(1.0)  # overlap of [0,2] with [1,3] is [1,2] = 1s

    def test_windowed_phonation_sec_includes_open_speech_segment(self):
        stats = RunningStats()
        phonation = stats.windowed_phonation_sec(0.0, 5.0, SegmentKind.SPEECH, 3.0, 5.0)
        assert phonation == pytest.approx(2.0)

    def test_pause_frequency_per_min(self):
        stats = RunningStats()
        stats.add_segments(
            [Segment(SegmentKind.PAUSE, 0.0, 0.5), Segment(SegmentKind.PAUSE, 1.0, 1.5)],
            window_sec=60.0,
            current_time=1.5,
        )
        assert stats.pause_frequency_per_min(elapsed_sec=30.0) == pytest.approx(4.0)  # 2 pauses / 0.5min

    def test_voice_activity_percent_includes_open_segment(self):
        stats = RunningStats()
        stats.add_segments([Segment(SegmentKind.SPEECH, 0.0, 3.0)], window_sec=60.0, current_time=3.0)
        pct = stats.voice_activity_percent(SegmentKind.SPEECH, open_duration=1.0, elapsed_sec=8.0)
        assert pct == pytest.approx(50.0)  # (3 + 1) / 8 * 100

    def test_speech_to_pause_ratio(self):
        stats = RunningStats()
        stats.add_segments(
            [Segment(SegmentKind.SPEECH, 0.0, 4.0), Segment(SegmentKind.PAUSE, 4.0, 5.0)],
            window_sec=60.0,
            current_time=5.0,
        )
        ratio = stats.speech_to_pause_ratio(SegmentKind.PAUSE, open_duration=0.0)
        assert ratio == pytest.approx(4.0)

    def test_speech_to_pause_ratio_none_when_no_pause_yet(self):
        stats = RunningStats()
        stats.add_segments([Segment(SegmentKind.SPEECH, 0.0, 4.0)], window_sec=60.0, current_time=4.0)
        assert stats.speech_to_pause_ratio(SegmentKind.SPEECH, open_duration=0.0) is None


class TestConsistencyFromCv:
    def test_none_cv_returns_full_consistency(self):
        assert _consistency_from_cv(None) == 1.0

    def test_zero_cv_is_fully_consistent(self):
        assert _consistency_from_cv(0.0) == 1.0

    def test_high_cv_clamped_to_zero(self):
        assert _consistency_from_cv(5.0) == 0.0

    def test_mid_cv_scales_linearly(self):
        assert _consistency_from_cv(0.3) == pytest.approx(0.7)


class TestCompositeScore:
    def test_perfect_match_scores_high(self):
        score = _composite_score(articulation_rate=4.0, baseline_rate=4.0, consistency=1.0, voice_activity_ratio=0.6)
        assert score == pytest.approx(100.0, abs=0.1)

    def test_large_deviation_scores_lower(self):
        near = _composite_score(articulation_rate=4.1, baseline_rate=4.0, consistency=1.0, voice_activity_ratio=0.6)
        far = _composite_score(articulation_rate=8.0, baseline_rate=4.0, consistency=1.0, voice_activity_ratio=0.6)
        assert far < near

    def test_zero_baseline_uses_neutral_closeness(self):
        score = _composite_score(articulation_rate=4.0, baseline_rate=0.0, consistency=1.0, voice_activity_ratio=0.6)
        assert 0.0 <= score <= 100.0

    def test_score_bounded_between_0_and_100(self):
        score = _composite_score(articulation_rate=100.0, baseline_rate=4.0, consistency=0.0, voice_activity_ratio=0.0)
        assert 0.0 <= score <= 100.0


class TestComputeFeatureSet:
    def test_articulation_rate_and_speech_rate_from_stats(self):
        stats = RunningStats()
        stats.add_segments([Segment(SegmentKind.SPEECH, 0.0, 4.0)], window_sec=4.0, current_time=4.0)
        stats.add_nuclei([0.5, 1.5, 2.5, 3.5], window_sec=4.0, current_time=4.0)

        features = compute_feature_set(
            stats,
            elapsed_sec=4.0,
            window_start=0.0,
            window_end=4.0,
            open_kind=SegmentKind.PAUSE,
            open_start=4.0,
            open_end=4.0,
            pitch_frames=[],
            baseline=BASELINE,
        )

        assert features.articulation_rate_sps == pytest.approx(1.0)  # 4 nuclei / 4s phonation
        assert features.speech_rate_wpm > 0
        assert features.voice_activity_percent == pytest.approx(100.0)

    def test_pitch_stats_from_voiced_frames(self):
        from app.pipeline.pitch import PitchFrame

        stats = RunningStats()
        pitch_frames = [
            PitchFrame(time=0.0, f0_hz=150.0, voiced=True),
            PitchFrame(time=0.1, f0_hz=170.0, voiced=True),
            PitchFrame(time=0.2, f0_hz=None, voiced=False),
        ]
        features = compute_feature_set(
            stats,
            elapsed_sec=1.0,
            window_start=0.0,
            window_end=1.0,
            open_kind=SegmentKind.PAUSE,
            open_start=1.0,
            open_end=1.0,
            pitch_frames=pitch_frames,
            baseline=BASELINE,
        )
        assert features.mean_pitch_hz == pytest.approx(160.0)
        assert features.pitch_variability_hz == pytest.approx(10.0)

    def test_no_pitch_frames_yields_none_pitch_stats(self):
        stats = RunningStats()
        features = compute_feature_set(
            stats,
            elapsed_sec=1.0,
            window_start=0.0,
            window_end=1.0,
            open_kind=SegmentKind.PAUSE,
            open_start=1.0,
            open_end=1.0,
            pitch_frames=[],
            baseline=BASELINE,
        )
        assert features.mean_pitch_hz is None
        assert features.pitch_variability_hz is None

    def test_no_phonation_yields_zero_articulation_rate(self):
        stats = RunningStats()
        features = compute_feature_set(
            stats,
            elapsed_sec=1.0,
            window_start=0.0,
            window_end=1.0,
            open_kind=SegmentKind.PAUSE,
            open_start=0.0,
            open_end=1.0,
            pitch_frames=[],
            baseline=BASELINE,
        )
        assert features.articulation_rate_sps == 0.0
        assert features.average_syllable_duration_sec is None

    def test_new_derived_fields_present(self):
        stats = RunningStats()
        stats.add_segments([Segment(SegmentKind.SPEECH, 0.0, 4.0)], window_sec=4.0, current_time=4.0)
        stats.add_nuclei([0.5, 1.5, 2.5, 3.5], window_sec=4.0, current_time=4.0)

        features = compute_feature_set(
            stats, elapsed_sec=4.0, window_start=0.0, window_end=4.0,
            open_kind=SegmentKind.PAUSE, open_start=4.0, open_end=4.0,
            pitch_frames=[], baseline=BASELINE,
        )
        assert features.total_syllables_session == 4
        assert features.total_words_session == pytest.approx(4 / 1.4)
        assert features.words_per_last_30_sec == pytest.approx(4 / 1.4)
        assert features.loudness_variability_db >= 0.0


class TestWordsPerLast30Sec:
    def test_independent_of_the_short_classification_window(self):
        stats = RunningStats()
        # Nuclei spread across 20s -- well outside a 4s classification
        # window, but still inside the 30s ring buffer.
        stats.add_nuclei([1.0, 5.0, 9.0, 13.0], window_sec=4.0, current_time=20.0)
        assert stats.windowed_nuclei_count() == 0  # none within the trailing 4s window
        assert stats.words_per_last_30_sec() == pytest.approx(4 / 1.4)

    def test_nuclei_older_than_30s_drop_out(self):
        stats = RunningStats()
        stats.add_nuclei([1.0], window_sec=4.0, current_time=1.0)
        stats.add_nuclei([40.0], window_sec=4.0, current_time=40.0)
        assert stats.words_per_last_30_sec() == pytest.approx(1 / 1.4)


class TestWindowedLoudnessStdDb:
    def test_zero_with_fewer_than_two_speech_frames(self):
        stats = RunningStats()
        assert stats.windowed_loudness_std_db() == 0.0

    def test_computes_std_of_speech_frame_energies(self):
        from app.pipeline.vad import FrameDecision

        stats = RunningStats()
        stats.add_frame_decisions(
            [
                FrameDecision(time=0.0, is_speech=True, energy_db=-20.0),
                FrameDecision(time=0.01, is_speech=True, energy_db=-10.0),
                FrameDecision(time=0.02, is_speech=False, energy_db=-50.0),
            ],
            window_sec=1.0,
        )
        assert stats.windowed_loudness_std_db() == pytest.approx(5.0)


class TestLinearSlope:
    def test_none_with_fewer_than_two_points(self):
        assert linear_slope([]) is None
        assert linear_slope([(0.0, 1.0)]) is None

    def test_positive_slope_for_increasing_values(self):
        slope = linear_slope([(0.0, 1.0), (1.0, 2.0), (2.0, 3.0)])
        assert slope == pytest.approx(1.0)

    def test_negative_slope_for_decreasing_values(self):
        slope = linear_slope([(0.0, 3.0), (1.0, 2.0), (2.0, 1.0)])
        assert slope == pytest.approx(-1.0)

    def test_zero_slope_for_constant_values(self):
        assert linear_slope([(0.0, 2.0), (1.0, 2.0), (2.0, 2.0)]) == pytest.approx(0.0)

    def test_zero_x_spread_does_not_divide_by_zero(self):
        assert linear_slope([(1.0, 5.0), (1.0, 9.0)]) == 0.0
