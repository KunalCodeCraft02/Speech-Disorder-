// Per-patient calibrated baseline. Ported from
// services/dsp-service/app/pipeline/baseline.py. Tachylalia-only: the
// bradylaliaThreshold field and demoMode population-default substitution
// for a real session are both removed — this is a single real user, and
// calibration is always required (see sessionPipeline.ts).

import type { Settings } from './config';

export interface BaselineProfile {
  baselineArticulationRate: number; // syllables/sec
  baselineArticulationRateStd: number;

  baselinePauseRatio: number; // mean speechToPauseRatio across calibration sub-windows
  baselinePauseRatioStd: number;

  baselineSyllableDurationSec: number;
  baselineSyllableDurationStd: number;

  baselineIpuLengthSec: number;
  baselineIpuLengthStd: number;

  tachylaliaThreshold: number; // syllables/sec, upper bound (fixed-multiplier fallback)

  /** True only when a genuine per-patient std (>=2 calibration sub-windows) is available — gates z-score vs. fixed-multiplier classification. */
  isPersonal: boolean;
}

export function defaultBaselineProfile(settings: Settings): BaselineProfile {
  const rate = settings.defaultBaselineArticulationRate;
  return {
    baselineArticulationRate: rate,
    baselineArticulationRateStd: settings.defaultBaselineArticulationRateStd,
    baselinePauseRatio: settings.defaultBaselinePauseRatio,
    baselinePauseRatioStd: settings.defaultBaselinePauseRatioStd,
    baselineSyllableDurationSec: settings.defaultBaselineSyllableDurationSec,
    baselineSyllableDurationStd: settings.defaultBaselineSyllableDurationStd,
    baselineIpuLengthSec: 1.0,
    baselineIpuLengthStd: settings.defaultBaselineSyllableDurationStd,
    tachylaliaThreshold: rate * settings.tachylaliaMultiplier,
    isPersonal: false,
  };
}

function meanStd(samples: number[]): { mean: number | null; std: number | null; n: number } {
  const values = samples.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (values.length === 0) return { mean: null, std: null, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let std = 0;
  if (values.length >= 2) {
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    std = Math.sqrt(variance);
  }
  return { mean, std, n: values.length };
}

/**
 * Builds a personal baseline from calibration sub-window samples (2
 * pooled ~20s clips, sliced into 4s sub-windows — see sessionPipeline.ts's
 * `analyzeCalibrationClip`). Needs >=2 sub-window samples for a std that
 * means anything; a single sample's std is always 0, which would
 * otherwise look "personal" but is really just noise.
 */
export function baselineFromSubwindowSamples(
  rateSamples: number[],
  pauseSamples: number[],
  syllableDurationSamples: number[],
  ipuLengthSamples: number[],
  settings: Settings
): BaselineProfile {
  const rate = meanStd(rateSamples);
  const pause = meanStd(pauseSamples);
  const syll = meanStd(syllableDurationSamples);
  const ipu = meanStd(ipuLengthSamples);

  const rateMean = rate.mean ?? settings.defaultBaselineArticulationRate;

  return {
    baselineArticulationRate: rateMean,
    baselineArticulationRateStd: rate.std ?? settings.defaultBaselineArticulationRateStd,
    baselinePauseRatio: pause.mean ?? settings.defaultBaselinePauseRatio,
    baselinePauseRatioStd: pause.std ?? settings.defaultBaselinePauseRatioStd,
    baselineSyllableDurationSec: syll.mean ?? settings.defaultBaselineSyllableDurationSec,
    baselineSyllableDurationStd: syll.std ?? settings.defaultBaselineSyllableDurationStd,
    baselineIpuLengthSec: ipu.mean ?? 1.0,
    baselineIpuLengthStd: ipu.std ?? settings.defaultBaselineSyllableDurationStd,
    tachylaliaThreshold: rateMean * settings.tachylaliaMultiplier,
    isPersonal: rate.n >= 2,
  };
}

/** Reconstructs a BaselineProfile from the flat fields persisted in IndexedDB (mirrors the shape stored by storage/calibration.ts). */
export function baselineFromStored(data: Partial<BaselineProfile> | null, settings: Settings): BaselineProfile | null {
  if (!data || data.baselineArticulationRate == null || data.baselineArticulationRate <= 0) return null;

  const rate = data.baselineArticulationRate;
  const rateStd = data.baselineArticulationRateStd ?? null;
  const isPersonal = rateStd != null && rateStd > 0;

  return {
    baselineArticulationRate: rate,
    baselineArticulationRateStd: isPersonal ? (rateStd as number) : settings.defaultBaselineArticulationRateStd,
    baselinePauseRatio: data.baselinePauseRatio ?? settings.defaultBaselinePauseRatio,
    baselinePauseRatioStd: data.baselinePauseRatioStd ?? settings.defaultBaselinePauseRatioStd,
    baselineSyllableDurationSec: data.baselineSyllableDurationSec ?? settings.defaultBaselineSyllableDurationSec,
    baselineSyllableDurationStd: data.baselineSyllableDurationStd ?? settings.defaultBaselineSyllableDurationStd,
    baselineIpuLengthSec: data.baselineIpuLengthSec ?? 1.0,
    baselineIpuLengthStd: data.baselineIpuLengthStd ?? settings.defaultBaselineSyllableDurationStd,
    tachylaliaThreshold: rate * settings.tachylaliaMultiplier,
    isPersonal,
  };
}
