import math

from app.pipeline.baseline import BaselineProfile
from app.pipeline.classifier import Classification, DisorderMode, HysteresisClassifier

SUFFICIENT = dict(syllables_in_window=10, phonation_sec_in_window=3.0)
INSUFFICIENT = dict(syllables_in_window=1, phonation_sec_in_window=0.2)


def personal_baseline(**overrides) -> BaselineProfile:
    base = dict(
        baseline_articulation_rate=4.0,
        baseline_articulation_rate_std=0.5,
        baseline_pause_ratio=1.5,
        baseline_pause_ratio_std=0.4,
        baseline_syllable_duration_sec=0.2,
        baseline_syllable_duration_std=0.03,
        baseline_ipu_length_sec=1.0,
        baseline_ipu_length_std=0.2,
        tachylalia_threshold=6.2,
        bradylalia_threshold=2.2,
        is_personal=True,
    )
    base.update(overrides)
    return BaselineProfile(**base)


def non_personal_baseline(**overrides) -> BaselineProfile:
    base = dict(
        baseline_articulation_rate=4.0,
        baseline_articulation_rate_std=0.6,
        baseline_pause_ratio=1.5,
        baseline_pause_ratio_std=0.6,
        baseline_syllable_duration_sec=0.2,
        baseline_syllable_duration_std=0.05,
        baseline_ipu_length_sec=1.0,
        baseline_ipu_length_std=0.05,
        tachylalia_threshold=6.2,  # 4.0 * 1.55
        bradylalia_threshold=2.2,  # 4.0 * 0.55
        is_personal=False,
    )
    base.update(overrides)
    return BaselineProfile(**base)


def at_baseline(rate: float, baseline: BaselineProfile) -> dict:
    """Rate-only deviation: pause/syllable held exactly at baseline so
    composite_z is driven by z_rate alone (isolates the tested dimension)."""
    return dict(
        articulation_rate=rate,
        speech_to_pause_ratio=baseline.baseline_pause_ratio,
        avg_syllable_duration_sec=baseline.baseline_syllable_duration_sec,
        baseline=baseline,
    )


class TestUncalibrated:
    def test_no_baseline_always_uncalibrated(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        for t in range(5):
            result = clf.update(
                articulation_rate=99.0,  # absurd rate — must still never classify without a baseline
                speech_to_pause_ratio=None,
                avg_syllable_duration_sec=None,
                baseline=None,
                current_time=float(t),
                **SUFFICIENT,
            )
            assert result.classification == Classification.UNCALIBRATED
            assert result.trigger_feedback is False
            assert result.confidence == 0.0

    def test_no_nan_or_inf_when_uncalibrated(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        result = clf.update(
            articulation_rate=6.0, speech_to_pause_ratio=None, avg_syllable_duration_sec=None,
            baseline=None, current_time=0.0, **SUFFICIENT,
        )
        for z in (result.z_rate, result.z_pause, result.z_syll, result.composite_z):
            assert math.isfinite(z)


class TestDisorderModeScoping:
    def test_tachylalia_mode_never_emits_bradylalia(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=2)
        baseline = personal_baseline()
        for t in range(10):
            result = clf.update(current_time=float(t), **at_baseline(0.5, baseline), **SUFFICIENT)
            assert result.classification in (Classification.NORMAL, Classification.TACHYLALIA)

    def test_bradylalia_mode_never_emits_tachylalia(self):
        clf = HysteresisClassifier(DisorderMode.BRADYLALIA, required_windows=2)
        baseline = personal_baseline()
        for t in range(10):
            result = clf.update(current_time=float(t), **at_baseline(20.0, baseline), **SUFFICIENT)
            assert result.classification in (Classification.NORMAL, Classification.BRADYLALIA)


class TestPersonalZScoreMethod:
    def test_rate_within_band_stays_normal(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=3)
        baseline = personal_baseline()
        for t in range(5):
            result = clf.update(current_time=float(t), **at_baseline(4.0, baseline), **SUFFICIENT)
            assert result.classification == Classification.NORMAL
            assert result.trigger_feedback is False

    def test_confirms_tachylalia_after_required_windows(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=3)
        baseline = personal_baseline()
        # rate=6.0 -> z_rate=(6-4)/0.5=4.0 -> composite_z=0.6*4=2.4 > Z_TACHYLALIA(2.0)
        results = [clf.update(current_time=float(t), **at_baseline(6.0, baseline), **SUFFICIENT) for t in range(3)]
        assert results[0].classification == Classification.NORMAL
        assert results[1].classification == Classification.NORMAL
        assert results[2].classification == Classification.TACHYLALIA
        assert results[2].trigger_feedback is True

    def test_confirms_bradylalia_symmetrically(self):
        clf = HysteresisClassifier(DisorderMode.BRADYLALIA, required_windows=2)
        baseline = personal_baseline()
        # rate=2.0 -> z_rate=(2-4)/0.5=-4.0 -> composite_z=-2.4 < -Z_BRADYLALIA(-2.0)
        clf.update(current_time=0.0, **at_baseline(2.0, baseline), **SUFFICIENT)
        result = clf.update(current_time=1.0, **at_baseline(2.0, baseline), **SUFFICIENT)
        assert result.classification == Classification.BRADYLALIA
        assert result.feedback_reason == Classification.BRADYLALIA

    def test_composite_z_uses_all_three_components(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        baseline = personal_baseline()
        # rate exactly at baseline (z_rate=0), but much higher speech:pause
        # ratio and much shorter syllables should still be able to push
        # composite_z positive via z_pause/z_syll alone.
        result = clf.update(
            articulation_rate=4.0,
            speech_to_pause_ratio=6.0,  # well above baseline 1.5
            avg_syllable_duration_sec=0.05,  # well below baseline 0.2
            baseline=baseline,
            current_time=0.0,
            **SUFFICIENT,
        )
        assert result.z_rate == 0.0
        assert result.z_pause > 0
        assert result.z_syll > 0  # shorter duration -> sign-flipped positive
        assert result.composite_z > 0

    def test_std_floor_prevents_divide_by_zero(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        baseline = personal_baseline(baseline_articulation_rate_std=0.0, baseline_pause_ratio_std=0.0, baseline_syllable_duration_std=0.0)
        result = clf.update(current_time=0.0, **at_baseline(50.0, baseline), **SUFFICIENT)
        for z in (result.z_rate, result.z_pause, result.z_syll, result.composite_z):
            assert math.isfinite(z)


class TestNonPersonalFallbackMethod:
    def test_uses_fixed_multiplier_not_zscore(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        baseline = non_personal_baseline()  # tachylalia_threshold = 6.2
        below_threshold = clf.update(current_time=0.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        assert below_threshold.classification == Classification.NORMAL

        clf2 = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        above_threshold = clf2.update(current_time=0.0, **at_baseline(6.5, baseline), **SUFFICIENT)
        assert above_threshold.classification == Classification.TACHYLALIA

    def test_still_exposes_descriptive_z_scores(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        baseline = non_personal_baseline()
        result = clf.update(current_time=0.0, **at_baseline(6.5, baseline), **SUFFICIENT)
        assert math.isfinite(result.composite_z)


class TestMinimumSampleGating:
    def test_insufficient_window_carries_forward_confirmed_state(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=2)
        baseline = personal_baseline()
        clf.update(current_time=0.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        confirmed = clf.update(current_time=1.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        assert confirmed.classification == Classification.TACHYLALIA

        # A noisy, near-silent window must not flip this back.
        noisy = clf.update(current_time=2.0, **at_baseline(0.1, baseline), **INSUFFICIENT)
        assert noisy.classification == Classification.TACHYLALIA
        assert noisy.sample_sufficient is False
        assert noisy.trigger_feedback is False

    def test_insufficient_window_does_not_reset_hysteresis_progress(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=3)
        baseline = personal_baseline()
        clf.update(current_time=0.0, **at_baseline(6.0, baseline), **SUFFICIENT)  # tachy raw, counter=1
        clf.update(current_time=1.0, **INSUFFICIENT, articulation_rate=6.0, speech_to_pause_ratio=baseline.baseline_pause_ratio, avg_syllable_duration_sec=baseline.baseline_syllable_duration_sec, baseline=baseline)  # skipped, counter untouched
        clf.update(current_time=2.0, **at_baseline(6.0, baseline), **SUFFICIENT)  # tachy raw, counter=2
        result = clf.update(current_time=3.0, **at_baseline(6.0, baseline), **SUFFICIENT)  # tachy raw, counter=3 -> confirms
        assert result.classification == Classification.TACHYLALIA

    def test_sample_sufficient_flag_present_when_sufficient(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=1)
        baseline = personal_baseline()
        result = clf.update(current_time=0.0, **at_baseline(4.0, baseline), **SUFFICIENT)
        assert result.sample_sufficient is True


class TestHysteresisPerMode:
    def test_bradylalia_default_required_windows_higher_than_tachylalia(self):
        tachy_clf = HysteresisClassifier(DisorderMode.TACHYLALIA)
        brady_clf = HysteresisClassifier(DisorderMode.BRADYLALIA)
        assert brady_clf.required_windows > tachy_clf.required_windows

    def test_non_consecutive_windows_reset_the_counter(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=3)
        baseline = personal_baseline()
        clf.update(current_time=0.0, **at_baseline(6.0, baseline), **SUFFICIENT)  # tachy
        clf.update(current_time=1.0, **at_baseline(4.0, baseline), **SUFFICIENT)  # normal -- resets tachy counter
        clf.update(current_time=2.0, **at_baseline(6.0, baseline), **SUFFICIENT)  # tachy (counter=1)
        result = clf.update(current_time=3.0, **at_baseline(6.0, baseline), **SUFFICIENT)  # tachy (counter=2)
        assert result.classification == Classification.NORMAL  # not yet 3 in a row

    def test_returning_to_normal_requires_consecutive_normal_windows(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=2)
        baseline = personal_baseline()
        clf.update(current_time=0.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        clf.update(current_time=1.0, **at_baseline(6.0, baseline), **SUFFICIENT)  # confirmed tachy

        still_tachy = clf.update(current_time=2.0, **at_baseline(4.0, baseline), **SUFFICIENT)
        assert still_tachy.classification == Classification.TACHYLALIA

        recovered = clf.update(current_time=3.0, **at_baseline(4.0, baseline), **SUFFICIENT)
        assert recovered.classification == Classification.NORMAL


class TestFeedbackRefractory:
    def test_refractory_period_suppresses_reaffirmation(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=2, refractory_sec=4.0)
        baseline = personal_baseline()
        clf.update(current_time=0.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        confirming = clf.update(current_time=1.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        assert confirming.trigger_feedback is True

        soon_after = clf.update(current_time=2.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        assert soon_after.trigger_feedback is False

    def test_reaffirms_feedback_after_refractory_elapses(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=2, refractory_sec=4.0)
        baseline = personal_baseline()
        clf.update(current_time=0.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        clf.update(current_time=1.0, **at_baseline(6.0, baseline), **SUFFICIENT)

        later = clf.update(current_time=6.0, **at_baseline(6.0, baseline), **SUFFICIENT)
        assert later.trigger_feedback is True


class TestConfidence:
    def test_confidence_bounded(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=4)
        baseline = personal_baseline()
        for t in range(6):
            result = clf.update(current_time=float(t), **at_baseline(6.0, baseline), **SUFFICIENT)
            assert 0.0 <= result.confidence <= 1.0

    def test_confidence_increases_with_progress_toward_confirmation(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=4)
        baseline = personal_baseline()
        confidences = [clf.update(current_time=float(t), **at_baseline(6.0, baseline), **SUFFICIENT).confidence for t in range(4)]
        assert confidences == sorted(confidences)


class TestConstructorDefaults:
    def test_required_windows_at_least_one(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA, required_windows=0, refractory_sec=1.0)
        assert clf.required_windows == 1

    def test_falls_back_to_settings_when_not_given(self):
        clf = HysteresisClassifier(DisorderMode.TACHYLALIA)
        assert clf.required_windows >= 1
        assert clf.refractory_sec > 0
