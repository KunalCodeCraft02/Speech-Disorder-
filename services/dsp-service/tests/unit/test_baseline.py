import pytest

from app.core.config import Settings
from app.pipeline.baseline import BaselineProfile, derive_baseline_from_rate


def make_settings(**overrides) -> Settings:
    return Settings(**overrides)


class TestBaselineProfileDefault:
    def test_thresholds_derived_from_multipliers(self):
        settings = make_settings(
            default_baseline_articulation_rate=4.0,
            tachylalia_multiplier=1.5,
            bradylalia_multiplier=0.5,
        )
        profile = BaselineProfile.default(settings)
        assert profile.baseline_articulation_rate == 4.0
        assert profile.tachylalia_threshold == 6.0
        assert profile.bradylalia_threshold == 2.0

    def test_is_never_personal(self):
        assert BaselineProfile.default().is_personal is False

    def test_uses_process_settings_when_none_given(self):
        profile = BaselineProfile.default()
        assert profile.baseline_articulation_rate > 0
        assert profile.baseline_articulation_rate_std > 0


class TestDeriveBaselineFromRate:
    def test_computes_thresholds_from_given_rate(self):
        settings = make_settings(tachylalia_multiplier=1.55, bradylalia_multiplier=0.55)
        profile = derive_baseline_from_rate(5.0, 1.2, settings)
        assert profile.baseline_articulation_rate == 5.0
        assert profile.baseline_pause_ratio == 1.2
        assert profile.tachylalia_threshold == pytest.approx(7.75)
        assert profile.bradylalia_threshold == pytest.approx(2.75)

    def test_manual_rate_is_never_personal(self):
        # No audio means no possible std -- always falls back to the
        # fixed-multiplier method, never the z-score method.
        profile = derive_baseline_from_rate(5.0, 1.2)
        assert profile.is_personal is False


class TestFromCalibrationDict:
    def test_none_is_uncalibrated(self):
        assert BaselineProfile.from_calibration_dict(None) is None

    def test_empty_dict_is_uncalibrated(self):
        assert BaselineProfile.from_calibration_dict({}) is None

    def test_missing_rate_is_uncalibrated(self):
        assert BaselineProfile.from_calibration_dict({"baselinePauseRatio": 1.2}) is None

    def test_non_numeric_rate_is_uncalibrated(self):
        data = {"baselineArticulationRate": "not-a-number"}
        assert BaselineProfile.from_calibration_dict(data) is None

    def test_zero_or_negative_rate_is_uncalibrated(self):
        assert BaselineProfile.from_calibration_dict({"baselineArticulationRate": 0}) is None
        assert BaselineProfile.from_calibration_dict({"baselineArticulationRate": -1.0}) is None

    def test_rate_with_std_is_personal(self):
        data = {
            "baselineArticulationRate": 4.5,
            "baselineArticulationRateStd": 0.4,
            "baselinePauseRatio": 1.6,
            "baselinePauseRatioStd": 0.3,
        }
        profile = BaselineProfile.from_calibration_dict(data)
        assert profile is not None
        assert profile.is_personal is True
        assert profile.baseline_articulation_rate == 4.5
        assert profile.baseline_articulation_rate_std == 0.4

    def test_rate_without_std_is_calibrated_but_not_personal(self):
        # A real baseline rate exists (this is NOT the uncalibrated state)
        # but with no personal std, classification must fall back to the
        # fixed-multiplier method rather than a z-score.
        data = {"baselineArticulationRate": 4.5}
        profile = BaselineProfile.from_calibration_dict(data)
        assert profile is not None
        assert profile.is_personal is False

    def test_zero_std_is_treated_as_no_std(self):
        data = {"baselineArticulationRate": 4.5, "baselineArticulationRateStd": 0.0}
        profile = BaselineProfile.from_calibration_dict(data)
        assert profile.is_personal is False


class TestFromSubwindowSamples:
    def test_pools_mean_and_std(self):
        profile = BaselineProfile.from_subwindow_samples(
            rate_samples=[4.0, 4.2, 3.8, 4.0],
            pause_samples=[1.5, 1.4, 1.6, 1.5],
            syllable_duration_samples=[0.2, 0.21, 0.19, 0.2],
            ipu_length_samples=[1.0, 1.1, 0.9, 1.0],
        )
        assert profile.is_personal is True
        assert profile.baseline_articulation_rate == pytest.approx(4.0, abs=0.01)
        assert profile.baseline_articulation_rate_std > 0

    def test_single_sample_is_not_personal(self):
        # A std computed from one sample is always zero and meaningless --
        # must not masquerade as a usable personal std.
        profile = BaselineProfile.from_subwindow_samples(
            rate_samples=[4.0],
            pause_samples=[1.5],
            syllable_duration_samples=[0.2],
            ipu_length_samples=[1.0],
        )
        assert profile.is_personal is False

    def test_empty_samples_falls_back_to_population_defaults(self):
        settings = make_settings()
        profile = BaselineProfile.from_subwindow_samples([], [], [], [], settings)
        assert profile.is_personal is False
        assert profile.baseline_articulation_rate == settings.default_baseline_articulation_rate
