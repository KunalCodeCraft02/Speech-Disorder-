"""Per-user calibrated baseline. Field names deliberately mirror the
gateway's `Profile` Mongoose model (services/gateway/src/models/Profile.js)
and the `calibration` object it sends in the WS `init` message, so no
translation layer is needed at the boundary.

Three distinct baseline states now exist (Part A/B of the classification
engine spec):

  1. **Uncalibrated** — no calibration at all for this patient.
     `from_calibration_dict` returns ``None`` and the session pipeline must
     not construct a `BaselineProfile` unless `demoMode` is set (see
     session_pipeline.py). The classifier only ever emits "uncalibrated" in
     this state.
  2. **Personal, with std** (`is_personal=True`) — the patient completed
     real calibration and a usable per-metric standard deviation was
     computed from calibration sub-windows (see `from_subwindow_samples`
     and Part A.2). Classification uses the z-score method
     (classifier.py) against this patient's own variance.
  3. **Non-personal** (`is_personal=False`, but not `None`) — either
     `demoMode`'s population default, or a legacy manual-rate calibration
     with no std available. Classification falls back to the fixed
     tachylalia/bradylalia multiplier thresholds instead of z-scores.

Note on `baseline_pause_ratio`: unlike the old population-default meaning
("fraction of session time spent paused", 0..1), this field is now the
**mean speechToPauseRatio computed across calibration sub-windows** — the
same live feature (`speechToPauseRatio`, speech-seconds ÷ pause-seconds)
that the classifier's z_pause term compares against (Part B.6). Keeping
both sides of that z-score on the same scale is what keeps z_pause
mathematically meaningful instead of a device that would otherwise ~always
saturate the composite score. The wire field name is kept for continuity
with the existing gateway Profile schema; only its unit changed.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class BaselineProfile:
    baseline_articulation_rate: float  # syllables/sec
    baseline_articulation_rate_std: float  # syllables/sec (floored at consumption time — see classifier.py)

    baseline_pause_ratio: float  # mean speechToPauseRatio across calibration sub-windows — see module docstring
    baseline_pause_ratio_std: float

    baseline_syllable_duration_sec: float
    baseline_syllable_duration_std: float

    baseline_ipu_length_sec: float
    baseline_ipu_length_std: float

    # Fixed-multiplier fallback thresholds — only actually used to decide
    # classification when is_personal is False (Part B.5); always populated
    # so a session can display them / fall back to them if calibration is
    # later found to lack a usable std.
    tachylalia_threshold: float  # syllables/sec, upper bound
    bradylalia_threshold: float  # syllables/sec, lower bound

    # True only when a genuine per-patient std (computed from >=2
    # calibration sub-windows) is available — gates the z-score
    # classification method vs. the fixed-multiplier fallback (Part B.5).
    is_personal: bool

    @classmethod
    def default(cls, settings: Settings | None = None) -> "BaselineProfile":
        """Population-default baseline. Only ever used for demoMode
        sessions (Part A.1) — never substituted in for a real patient."""
        s = settings or get_settings()
        rate = s.default_baseline_articulation_rate
        return cls(
            baseline_articulation_rate=rate,
            baseline_articulation_rate_std=s.default_baseline_articulation_rate_std,
            baseline_pause_ratio=s.default_baseline_pause_ratio,
            baseline_pause_ratio_std=s.default_baseline_pause_ratio_std,
            baseline_syllable_duration_sec=s.default_baseline_syllable_duration_sec,
            baseline_syllable_duration_std=s.default_baseline_syllable_duration_std,
            baseline_ipu_length_sec=1.0,
            baseline_ipu_length_std=s.default_baseline_syllable_duration_std,
            tachylalia_threshold=rate * s.tachylalia_multiplier,
            bradylalia_threshold=rate * s.bradylalia_multiplier,
            is_personal=False,
        )

    @classmethod
    def from_calibration_dict(cls, data: dict | None, settings: Settings | None = None) -> "BaselineProfile | None":
        """Builds a profile from the gateway's stored Profile fields.
        Returns ``None`` (uncalibrated) when there's no usable baseline
        rate at all — callers must not silently substitute the population
        default for a real session (Part A.1); that substitution is only
        valid behind an explicit `demoMode` flag, handled by the caller
        (session_pipeline.py), not here.
        """
        if not data:
            return None

        s = settings or get_settings()

        rate = _positive_float(data.get("baselineArticulationRate"))
        if rate is None:
            return None

        rate_std = _positive_float(data.get("baselineArticulationRateStd"))
        is_personal = rate_std is not None

        pause_mean = _float_or(data.get("baselinePauseRatio"), s.default_baseline_pause_ratio)
        syll_mean = _float_or(data.get("baselineSyllableDurationSec"), s.default_baseline_syllable_duration_sec)
        ipu_mean = _float_or(data.get("baselineIpuLengthSec"), 1.0)

        return cls(
            baseline_articulation_rate=rate,
            baseline_articulation_rate_std=rate_std if is_personal else s.default_baseline_articulation_rate_std,
            baseline_pause_ratio=pause_mean,
            baseline_pause_ratio_std=_positive_float(data.get("baselinePauseRatioStd")) or s.default_baseline_pause_ratio_std,
            baseline_syllable_duration_sec=syll_mean,
            baseline_syllable_duration_std=_positive_float(data.get("baselineSyllableDurationStd")) or s.default_baseline_syllable_duration_std,
            baseline_ipu_length_sec=ipu_mean,
            baseline_ipu_length_std=_positive_float(data.get("baselineIpuLengthStd")) or s.default_baseline_syllable_duration_std,
            tachylalia_threshold=rate * s.tachylalia_multiplier,
            bradylalia_threshold=rate * s.bradylalia_multiplier,
            is_personal=is_personal,
        )

    @classmethod
    def from_subwindow_samples(
        cls,
        rate_samples: list[float],
        pause_samples: list[float],
        syllable_duration_samples: list[float],
        ipu_length_samples: list[float],
        settings: Settings | None = None,
    ) -> "BaselineProfile":
        """Builds a personal baseline from calibration sub-window samples
        (Part A.2). Callers pool samples from multiple clips by simply
        concatenating the lists before calling this — see
        session_pipeline.analyze_calibration_clips, which is the only
        caller (Part A.4: 2 clips > 1, pooled mean/std)."""
        s = settings or get_settings()

        rate_mean, rate_std, rate_n = _mean_std(rate_samples)
        pause_mean, pause_std, _ = _mean_std(pause_samples)
        syll_mean, syll_std, _ = _mean_std(syllable_duration_samples)
        ipu_mean, ipu_std, _ = _mean_std(ipu_length_samples)

        return cls(
            baseline_articulation_rate=rate_mean if rate_mean is not None else s.default_baseline_articulation_rate,
            baseline_articulation_rate_std=rate_std if rate_std is not None else s.default_baseline_articulation_rate_std,
            baseline_pause_ratio=pause_mean if pause_mean is not None else s.default_baseline_pause_ratio,
            baseline_pause_ratio_std=pause_std if pause_std is not None else s.default_baseline_pause_ratio_std,
            baseline_syllable_duration_sec=syll_mean if syll_mean is not None else s.default_baseline_syllable_duration_sec,
            baseline_syllable_duration_std=syll_std if syll_std is not None else s.default_baseline_syllable_duration_std,
            baseline_ipu_length_sec=ipu_mean if ipu_mean is not None else 1.0,
            baseline_ipu_length_std=ipu_std if ipu_std is not None else s.default_baseline_syllable_duration_std,
            tachylalia_threshold=(rate_mean or s.default_baseline_articulation_rate) * s.tachylalia_multiplier,
            bradylalia_threshold=(rate_mean or s.default_baseline_articulation_rate) * s.bradylalia_multiplier,
            # Need >=2 sub-window samples for a std that means anything —
            # a single sub-window can only ever produce std=0, which would
            # otherwise look "personal" but is really just noise.
            is_personal=rate_n >= 2,
        )


def derive_baseline_from_rate(
    baseline_rate: float,
    pause_ratio: float,
    settings: Settings | None = None,
) -> BaselineProfile:
    """Legacy path: a manually-supplied articulation rate with no audio
    (and therefore no possible std) — used by /calibrate when the caller
    supplies `referenceStats.articulationRateSPS` directly. This still
    counts as "calibrated" (not uncalibrated — a real baseline rate is on
    file), but always falls back to the fixed-multiplier method since
    there's no personal variance to build a z-score from."""
    s = settings or get_settings()
    return BaselineProfile(
        baseline_articulation_rate=baseline_rate,
        baseline_articulation_rate_std=s.default_baseline_articulation_rate_std,
        baseline_pause_ratio=pause_ratio,
        baseline_pause_ratio_std=s.default_baseline_pause_ratio_std,
        baseline_syllable_duration_sec=s.default_baseline_syllable_duration_sec,
        baseline_syllable_duration_std=s.default_baseline_syllable_duration_std,
        baseline_ipu_length_sec=1.0,
        baseline_ipu_length_std=s.default_baseline_syllable_duration_std,
        tachylalia_threshold=baseline_rate * s.tachylalia_multiplier,
        bradylalia_threshold=baseline_rate * s.bradylalia_multiplier,
        is_personal=False,
    )


def _positive_float(value: object) -> float | None:
    try:
        f = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _float_or(value: object, fallback: float) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback


def _mean_std(samples: list[float]) -> tuple[float | None, float | None, int]:
    values = [float(v) for v in samples if v is not None]
    if not values:
        return None, None, 0
    arr = np.asarray(values, dtype=np.float64)
    mean = float(np.mean(arr))
    std = float(np.std(arr)) if len(values) >= 2 else 0.0
    return mean, std, len(values)
