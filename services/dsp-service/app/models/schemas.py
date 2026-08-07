from datetime import datetime

from pydantic import BaseModel, Field


class ReferenceClip(BaseModel):
    """One calibration recording. `referenceStats.clips` may contain more
    than one (Part A.4 — 2 short clips pooled together are preferred over a
    single longer one, since a single clip understates natural variability)."""

    audioBase64: str
    sampleRate: int | None = None


class ReferenceStats(BaseModel):
    """/calibrate accepts whichever of these the caller has available, in
    priority order: `clips` (current, multi-clip flow, Part A.2/A.4) >
    `audioBase64` (legacy single-clip — normalized into a 1-element clips
    list internally, so it goes through the same sub-window/std/phonation
    pipeline) > `articulationRateSPS` (manual rate, no audio — never
    produces a personal std, see baseline.py's `derive_baseline_from_rate`)."""

    clips: list[ReferenceClip] | None = None

    audioBase64: str | None = None
    sampleRate: int | None = None

    articulationRateSPS: float | None = Field(default=None, ge=0)
    # Speech-to-pause ratio scale (speech seconds / pause seconds), not a
    # 0..1 fraction-of-time — see baseline.py's module docstring.
    pauseRatio: float | None = Field(default=None, ge=0)


class CalibrationRequest(BaseModel):
    userId: str
    referenceStats: ReferenceStats | None = None
    # Only relevant when referenceStats is entirely absent — permits
    # falling back to the population-default baseline (Part A.1). Must
    # never be relied on for a real patient session.
    demoMode: bool = False


class CalibrationResponse(BaseModel):
    # Classifier baseline — drives real-time Tachylalia/Bradylalia detection
    # (see app/pipeline/baseline.py, BaselineProfile). The *Std fields and
    # isPersonal are new (Part A.2/B.5): isPersonal=True is what unlocks the
    # z-score classification method for this patient instead of the fixed
    # tachylalia/bradylaliaThreshold fallback (still populated either way).
    baselineArticulationRate: float
    baselineArticulationRateStd: float
    baselinePauseRatio: float
    baselinePauseRatioStd: float
    baselineSyllableDurationSec: float
    baselineSyllableDurationStd: float
    baselineIpuLengthSec: float
    baselineIpuLengthStd: float
    isPersonal: bool
    tachylaliaThreshold: float
    bradylaliaThreshold: float

    # Descriptive baseline snapshot from the calibration reading(s) — for
    # display and for comparing future sessions against, not consumed by
    # the classifier. Null when calibration ran without an audio sample
    # (e.g. a manually-supplied articulation rate).
    baselineSpeechRateWPM: float | None = None
    baselinePitchHz: float | None = None
    baselineLoudnessDb: float | None = None
    baselinePauseDurationSec: float | None = None
    baselineSpeechRatio: float | None = None

    durationSec: float | None = None
    syllableCount: int | None = None
    clipCount: int = 0

    calibratedAt: datetime


class HealthResponse(BaseModel):
    status: str
    activeSessions: int
    version: str


class ModelVersionResponse(BaseModel):
    pipelineVersion: str
    algorithm: str
    sampleRate: int
