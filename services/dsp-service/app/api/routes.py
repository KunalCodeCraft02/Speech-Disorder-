import base64
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.config import get_settings
from app.core.security import verify_service_token
from app.models.schemas import (
    CalibrationRequest,
    CalibrationResponse,
    HealthResponse,
    ModelVersionResponse,
    ReferenceClip,
)
from app.pipeline.baseline import BaselineProfile, derive_baseline_from_rate
from app.pipeline.preprocessing import pcm16_bytes_to_float32
from app.pipeline.session_pipeline import CalibrationClipResult, analyze_calibration_clip
from app.session.registry import registry

router = APIRouter()

PIPELINE_VERSION = "2.0.0"
PIPELINE_ALGORITHM = "energy+zcr VAD / De Jong-Wempe intensity nuclei / autocorrelation F0 / personal z-score classification"


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", activeSessions=registry.count(), version=PIPELINE_VERSION)


@router.get("/models/version", response_model=ModelVersionResponse, dependencies=[Depends(verify_service_token)])
async def models_version() -> ModelVersionResponse:
    settings = get_settings()
    return ModelVersionResponse(
        pipelineVersion=PIPELINE_VERSION,
        algorithm=PIPELINE_ALGORITHM,
        sampleRate=settings.sample_rate,
    )


def _decode_clip(clip: ReferenceClip, settings) -> tuple:
    try:
        raw = base64.b64decode(clip.audioBase64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="referenceStats clip audioBase64 is not valid base64") from exc

    sample_rate = clip.sampleRate or settings.sample_rate
    pcm_float = pcm16_bytes_to_float32(raw)
    if pcm_float.size < sample_rate * 0.5:
        raise HTTPException(status_code=400, detail="Each calibration clip must be at least 0.5s of audio")
    return pcm_float, sample_rate


def _weighted_mean(clip_results: list[CalibrationClipResult], key: str) -> float | None:
    pairs = [(c.descriptive.get(key), c.duration_sec) for c in clip_results if c.descriptive.get(key) is not None]
    total_weight = sum(w for _, w in pairs)
    if not pairs or total_weight <= 0:
        return None
    return sum(v * w for v, w in pairs) / total_weight


def _pool_descriptive(clip_results: list[CalibrationClipResult]) -> dict:
    def r(key: str, ndigits: int) -> float | None:
        v = _weighted_mean(clip_results, key)
        return round(v, ndigits) if v is not None else None

    return {
        "baselineSpeechRateWPM": r("speechRateWPM", 2),
        "baselinePitchHz": r("meanPitchHz", 1),
        "baselineLoudnessDb": r("loudnessDb", 2),
        "baselinePauseDurationSec": r("pauseDurationSec", 3),
        "baselineSpeechRatio": r("speechRatio", 3),
    }


@router.post("/calibrate", response_model=CalibrationResponse, dependencies=[Depends(verify_service_token)])
async def calibrate(payload: CalibrationRequest) -> CalibrationResponse:
    """Part A of the classification engine spec:
    - Prefers 2+ short clips pooled together over one longer clip (A.4).
    - Rejects attempts with <MIN_CALIBRATION_PHONATION_SEC actual phonation,
      not just a minimum recording length (A.3).
    - Computes mean *and* std per metric from 4s calibration sub-windows,
      so the classifier can z-score against this patient's own spread (A.2).
    - Never silently substitutes the population default for a real patient
      — that fallback only exists behind an explicit demoMode flag (A.1).
    """
    settings = get_settings()
    ref = payload.referenceStats

    clips: list[ReferenceClip] = []
    if ref and ref.clips:
        clips = ref.clips
    elif ref and ref.audioBase64:
        clips = [ReferenceClip(audioBase64=ref.audioBase64, sampleRate=ref.sampleRate)]

    descriptive: dict = {}
    clip_count = 0

    if clips:
        clip_results = [analyze_calibration_clip(*_decode_clip(clip, settings)) for clip in clips]

        total_phonation = sum(c.phonation_sec for c in clip_results)
        if total_phonation < settings.min_calibration_phonation_sec:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Only {total_phonation:.1f}s of actual speech detected across "
                    f"{len(clip_results)} clip(s); {settings.min_calibration_phonation_sec:.0f}s of phonation "
                    "is required. Please redo calibration and try to speak continuously through the passage."
                ),
            )

        rate_samples = [v for c in clip_results for v in c.rate_samples]
        pause_samples = [v for c in clip_results for v in c.pause_samples]
        syll_samples = [v for c in clip_results for v in c.syllable_duration_samples]
        ipu_samples = [v for c in clip_results for v in c.ipu_length_samples]

        baseline = BaselineProfile.from_subwindow_samples(rate_samples, pause_samples, syll_samples, ipu_samples, settings)

        clip_count = len(clip_results)
        descriptive = _pool_descriptive(clip_results)
        descriptive["durationSec"] = round(sum(c.duration_sec for c in clip_results), 2)
        descriptive["syllableCount"] = sum(c.syllable_count for c in clip_results)

    elif ref and ref.articulationRateSPS is not None:
        pause_ratio = ref.pauseRatio if ref.pauseRatio is not None else settings.default_baseline_pause_ratio
        baseline = derive_baseline_from_rate(ref.articulationRateSPS, pause_ratio, settings)

    elif payload.demoMode:
        baseline = BaselineProfile.default(settings)

    else:
        raise HTTPException(
            status_code=422,
            detail="Calibration requires audio (referenceStats.clips) or a manually supplied articulationRateSPS; "
            "the population-default baseline is only available with demoMode=true.",
        )

    return CalibrationResponse(
        baselineArticulationRate=round(baseline.baseline_articulation_rate, 3),
        baselineArticulationRateStd=round(baseline.baseline_articulation_rate_std, 3),
        baselinePauseRatio=round(baseline.baseline_pause_ratio, 3),
        baselinePauseRatioStd=round(baseline.baseline_pause_ratio_std, 3),
        baselineSyllableDurationSec=round(baseline.baseline_syllable_duration_sec, 4),
        baselineSyllableDurationStd=round(baseline.baseline_syllable_duration_std, 4),
        baselineIpuLengthSec=round(baseline.baseline_ipu_length_sec, 3),
        baselineIpuLengthStd=round(baseline.baseline_ipu_length_std, 3),
        isPersonal=baseline.is_personal,
        tachylaliaThreshold=round(baseline.tachylalia_threshold, 3),
        bradylaliaThreshold=round(baseline.bradylalia_threshold, 3),
        baselineSpeechRateWPM=descriptive.get("baselineSpeechRateWPM"),
        baselinePitchHz=descriptive.get("baselinePitchHz"),
        baselineLoudnessDb=descriptive.get("baselineLoudnessDb"),
        baselinePauseDurationSec=descriptive.get("baselinePauseDurationSec"),
        baselineSpeechRatio=descriptive.get("baselineSpeechRatio"),
        durationSec=descriptive.get("durationSec"),
        syllableCount=descriptive.get("syllableCount"),
        clipCount=clip_count,
        calibratedAt=datetime.now(timezone.utc),
    )
