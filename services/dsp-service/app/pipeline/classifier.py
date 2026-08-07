"""Hysteresis classification state machine.

A single window's articulation rate crossing a threshold is not enough to
declare Tachylalia/Bradylalia — ordinary speech-rate variation would flicker
the classification (and the phone's vibration feedback) constantly. The
classifier instead requires a deviation to persist across
`required_windows` consecutive analysis passes before confirming a state
change (see architecture §08), and — once confirmed — re-fires feedback
only on the confirming edge plus periodic reaffirmation while the state
stays abnormal, rather than on every single window.

Three behavior changes from the original rate-only design (see
CLASSIFICATION_ENGINE.md for the full spec this implements):

- **Uncalibrated gating** — a session with no baseline at all (real patient,
  never calibrated, not demoMode) never emits tachylalia/bradylalia; it can
  only ever report `Classification.UNCALIBRATED`.
- **Multi-parameter corroboration** — the raw label is decided from a
  composite z-score (rate + pause + syllable duration against the
  patient's own calibrated variance) rather than articulation rate alone,
  when a personal std is available. Sessions without one (demoMode/
  population-default) fall back to the original fixed-multiplier method.
- **disorderMode scoping** — a session is opened in either tachylalia or
  bradylalia mode (set once, at session start) and can only ever confirm
  that single direction plus NORMAL — never the other disorder.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import numpy as np

from app.core.config import get_settings
from app.pipeline import constants as C
from app.pipeline.baseline import BaselineProfile


class Classification(str, Enum):
    UNCALIBRATED = "uncalibrated"
    NORMAL = "normal"
    TACHYLALIA = "tachylalia"
    BRADYLALIA = "bradylalia"


class DisorderMode(str, Enum):
    TACHYLALIA = "tachylalia"
    BRADYLALIA = "bradylalia"


@dataclass(frozen=True)
class ClassificationResult:
    classification: Classification  # confirmed (hysteresis-passed) state
    raw: Classification  # this window's raw label, pre-hysteresis — for logging/audit (Part G), not sent over the wire
    confidence: float
    trigger_feedback: bool
    feedback_reason: Classification | None
    z_rate: float
    z_pause: float
    z_syll: float
    composite_z: float
    sample_sufficient: bool


def _zscore(value: float | None, mean: float, std: float, floor: float) -> float:
    if value is None:
        return 0.0
    denom = max(std, floor)
    return (value - mean) / denom


class HysteresisClassifier:
    def __init__(
        self,
        disorder_mode: DisorderMode,
        required_windows: int | None = None,
        refractory_sec: float | None = None,
    ) -> None:
        settings = get_settings()
        self.settings = settings
        self.disorder_mode = disorder_mode

        default_required = (
            settings.hysteresis_windows
            if disorder_mode == DisorderMode.TACHYLALIA
            else settings.hysteresis_windows_bradylalia
        )
        self.required_windows = max(1, required_windows if required_windows is not None else default_required)
        self.refractory_sec = refractory_sec if refractory_sec is not None else settings.feedback_refractory_sec

        self._confirmed = Classification.NORMAL
        self._raw_counters: dict[Classification, int] = {c: 0 for c in Classification}
        self._last_feedback_time: float | None = None
        self._last_confidence = 0.0

    def update(
        self,
        *,
        articulation_rate: float,
        speech_to_pause_ratio: float | None,
        avg_syllable_duration_sec: float | None,
        syllables_in_window: int,
        phonation_sec_in_window: float,
        baseline: BaselineProfile | None,
        current_time: float,
    ) -> ClassificationResult:
        if baseline is None:
            # Part A.1: no calibration at all for this (non-demoMode)
            # patient — never emit tachylalia/bradylalia, ever.
            return ClassificationResult(
                classification=Classification.UNCALIBRATED,
                raw=Classification.UNCALIBRATED,
                confidence=0.0,
                trigger_feedback=False,
                feedback_reason=None,
                z_rate=0.0,
                z_pause=0.0,
                z_syll=0.0,
                composite_z=0.0,
                sample_sufficient=False,
            )

        settings = self.settings

        z_rate = _zscore(
            articulation_rate, baseline.baseline_articulation_rate, baseline.baseline_articulation_rate_std, settings.baseline_std_floor
        )
        z_pause = _zscore(
            speech_to_pause_ratio, baseline.baseline_pause_ratio, baseline.baseline_pause_ratio_std, C.PAUSE_RATIO_STD_FLOOR
        )
        # Shorter syllables == faster speech == tachylalia direction, so the
        # raw (value-mean)/std sign is flipped here to match the "positive
        # = tachy direction, negative = brady direction" convention z_rate
        # and z_pause already follow (Part B.6).
        z_syll = -_zscore(
            avg_syllable_duration_sec, baseline.baseline_syllable_duration_sec, baseline.baseline_syllable_duration_std, C.SYLLABLE_DURATION_STD_FLOOR
        )

        composite_z = C.COMPOSITE_Z_WEIGHT_RATE * z_rate + C.COMPOSITE_Z_WEIGHT_PAUSE * z_pause + C.COMPOSITE_Z_WEIGHT_SYLL * z_syll

        sample_sufficient = (
            syllables_in_window >= settings.min_syllables_per_window
            and phonation_sec_in_window >= settings.min_phonation_sec_per_window
        )

        if not sample_sufficient:
            # Part B.7: a mostly-silent/too-short window must not inject a
            # noisy rate estimate into the decision — carry the previous
            # confirmed state forward untouched, without resetting the
            # hysteresis counters (so a borderline run of good windows
            # isn't punished by one bad one landing in between).
            reason = self._confirmed if self._confirmed not in (Classification.NORMAL, Classification.UNCALIBRATED) else None
            return ClassificationResult(
                classification=self._confirmed,
                raw=self._confirmed,
                confidence=self._last_confidence,
                trigger_feedback=False,
                feedback_reason=reason,
                z_rate=z_rate,
                z_pause=z_pause,
                z_syll=z_syll,
                composite_z=composite_z,
                sample_sufficient=False,
            )

        # --- Step 1: raw label, scoped to a single direction by disorderMode (Part B.8) ---
        if baseline.is_personal:
            if self.disorder_mode == DisorderMode.TACHYLALIA:
                raw = Classification.TACHYLALIA if composite_z > settings.z_tachylalia else Classification.NORMAL
            else:
                raw = Classification.BRADYLALIA if composite_z < -settings.z_bradylalia else Classification.NORMAL
        else:
            # demoMode/population-default (or a std-less legacy manual-rate
            # calibration): fixed-multiplier fallback (Part B.5).
            if self.disorder_mode == DisorderMode.TACHYLALIA:
                raw = Classification.TACHYLALIA if articulation_rate > baseline.tachylalia_threshold else Classification.NORMAL
            else:
                raw = Classification.BRADYLALIA if articulation_rate < baseline.bradylalia_threshold else Classification.NORMAL

        # --- Step 2: hysteresis confirmation (prevents flicker) ---
        for label in self._raw_counters:
            self._raw_counters[label] = self._raw_counters[label] + 1 if label == raw else 0

        progress = min(1.0, self._raw_counters[raw] / self.required_windows)

        edge = False
        if self._raw_counters[raw] >= self.required_windows and self._confirmed != raw:
            self._confirmed = raw
            edge = True

        # --- Step 3: confidence (Part B.9) ---
        if raw == Classification.TACHYLALIA:
            direction = 1.0
        elif raw == Classification.BRADYLALIA:
            direction = -1.0
        else:
            # NORMAL raw label has no inherent "direction" to corroborate —
            # score corroboration against whichever way composite_z is
            # currently leaning, which is the only well-defined choice.
            direction = 1.0 if composite_z >= 0 else -1.0

        components = (z_rate, z_pause, z_syll)
        agreeing = sum(1 for z in components if (z * direction) > 0)
        corroboration = agreeing / 3.0

        sample_factor = min(1.0, syllables_in_window / (settings.min_syllables_per_window * 2))

        confidence = float(
            np.clip(
                C.CONFIDENCE_WEIGHT_PROGRESS * progress
                + C.CONFIDENCE_WEIGHT_CORROBORATION * corroboration
                + C.CONFIDENCE_WEIGHT_COMPOSITE_Z * min(1.0, abs(composite_z) / C.CONFIDENCE_COMPOSITE_Z_SCALE)
                + C.CONFIDENCE_WEIGHT_SAMPLE * sample_factor,
                0.0,
                1.0,
            )
        )
        self._last_confidence = confidence

        # --- Step 4: feedback (vibration) trigger ---
        trigger = False
        reason: Classification | None = None
        if self._confirmed != Classification.NORMAL:
            reason = self._confirmed
            if edge:
                trigger = True
            elif self._last_feedback_time is None or (current_time - self._last_feedback_time) >= self.refractory_sec:
                trigger = True

        if trigger:
            self._last_feedback_time = current_time

        return ClassificationResult(
            classification=self._confirmed,
            raw=raw,
            confidence=confidence,
            trigger_feedback=trigger,
            feedback_reason=reason,
            z_rate=z_rate,
            z_pause=z_pause,
            z_syll=z_syll,
            composite_z=composite_z,
            sample_sufficient=True,
        )
