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

  baselineInterSyllableIntervalSec: number;
  baselineInterSyllableIntervalStd: number;

  baselinePauseDurationSec: number;
  baselinePauseDurationStd: number;

  baselinePauseFrequencyPerMin: number;
  baselinePauseFrequencyStd: number;

  baselineMeanPitchHz: number;
  baselineMeanPitchStd: number;

  baselineLoudnessDb: number;
  baselineLoudnessStd: number;

  baselineVoiceActivityPercent: number;
  baselineVoiceActivityStd: number;

  /** Item 1/6: condition_2's personal baseline (was a fixed population number, constants.ts's now-unused WORDS_PER_30SEC_TACHYLALIA_THRESHOLD). Derived from the same per-subwindow speechRateWPM samples as baselineSpeechRateWPM (elapsed-time-normalized, includes pauses -- see sessionPipeline.ts's CalibrationClipResult.speechRateWpmSamples doc comment), divided by 2 (30s = half a minute). */
  baselineWordsPer30Sec: number;
  baselineWordsPer30SecStd: number;

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
    baselineIpuLengthSec: settings.defaultBaselineIpuLengthSec,
    baselineIpuLengthStd: settings.defaultBaselineIpuLengthStd,
    baselineInterSyllableIntervalSec: settings.defaultBaselineInterSyllableIntervalSec,
    baselineInterSyllableIntervalStd: settings.defaultBaselineInterSyllableIntervalStd,
    baselinePauseDurationSec: settings.defaultBaselinePauseDurationSec,
    baselinePauseDurationStd: settings.defaultBaselinePauseDurationStd,
    baselinePauseFrequencyPerMin: settings.defaultBaselinePauseFrequencyPerMin,
    baselinePauseFrequencyStd: settings.defaultBaselinePauseFrequencyStd,
    baselineMeanPitchHz: settings.defaultBaselineMeanPitchHz,
    baselineMeanPitchStd: settings.defaultBaselineMeanPitchStd,
    baselineLoudnessDb: settings.defaultBaselineLoudnessDb,
    baselineLoudnessStd: settings.defaultBaselineLoudnessStd,
    baselineVoiceActivityPercent: settings.defaultBaselineVoiceActivityPercent,
    baselineVoiceActivityStd: settings.defaultBaselineVoiceActivityStd,
    baselineWordsPer30Sec: settings.defaultBaselineWordsPer30Sec,
    baselineWordsPer30SecStd: settings.defaultBaselineWordsPer30SecStd,
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
  settings: Settings,
  extra?: {
    interSyllableIntervalSamples?: number[];
    pauseDurationSamples?: number[];
    pauseFrequencySamples?: number[];
    meanPitchSamples?: number[];
    loudnessSamples?: number[];
    voiceActivitySamples?: number[];
    /** Item 1/6: per-subwindow speechRateWPM samples -- see sessionPipeline.ts's CalibrationClipResult.speechRateWpmSamples doc comment for why WPM (not articulationRateSPS) is the right basis. Converted to words/30sec (÷2) below. */
    speechRateWpmSamples?: number[];
  }
): BaselineProfile {
  const rate = meanStd(rateSamples);
  const pause = meanStd(pauseSamples);
  const syll = meanStd(syllableDurationSamples);
  const ipu = meanStd(ipuLengthSamples);
  const isi = meanStd(extra?.interSyllableIntervalSamples ?? []);
  const pauseDur = meanStd(extra?.pauseDurationSamples ?? []);
  const pauseFreq = meanStd(extra?.pauseFrequencySamples ?? []);
  const pitch = meanStd(extra?.meanPitchSamples ?? []);
  const loudness = meanStd(extra?.loudnessSamples ?? []);
  const voiceActivity = meanStd(extra?.voiceActivitySamples ?? []);
  const wordsPer30Sec = meanStd((extra?.speechRateWpmSamples ?? []).map((wpm) => wpm / 2));

  const rateMean = rate.mean ?? settings.defaultBaselineArticulationRate;

  return {
    baselineArticulationRate: rateMean,
    baselineArticulationRateStd: rate.std ?? settings.defaultBaselineArticulationRateStd,
    baselinePauseRatio: pause.mean ?? settings.defaultBaselinePauseRatio,
    baselinePauseRatioStd: pause.std ?? settings.defaultBaselinePauseRatioStd,
    baselineSyllableDurationSec: syll.mean ?? settings.defaultBaselineSyllableDurationSec,
    baselineSyllableDurationStd: syll.std ?? settings.defaultBaselineSyllableDurationStd,
    baselineIpuLengthSec: ipu.mean ?? settings.defaultBaselineIpuLengthSec,
    baselineIpuLengthStd: ipu.std ?? settings.defaultBaselineIpuLengthStd,
    baselineInterSyllableIntervalSec: isi.mean ?? settings.defaultBaselineInterSyllableIntervalSec,
    baselineInterSyllableIntervalStd: isi.std ?? settings.defaultBaselineInterSyllableIntervalStd,
    baselinePauseDurationSec: pauseDur.mean ?? settings.defaultBaselinePauseDurationSec,
    baselinePauseDurationStd: pauseDur.std ?? settings.defaultBaselinePauseDurationStd,
    baselinePauseFrequencyPerMin: pauseFreq.mean ?? settings.defaultBaselinePauseFrequencyPerMin,
    baselinePauseFrequencyStd: pauseFreq.std ?? settings.defaultBaselinePauseFrequencyStd,
    baselineMeanPitchHz: pitch.mean ?? settings.defaultBaselineMeanPitchHz,
    baselineMeanPitchStd: pitch.std ?? settings.defaultBaselineMeanPitchStd,
    baselineLoudnessDb: loudness.mean ?? settings.defaultBaselineLoudnessDb,
    baselineLoudnessStd: loudness.std ?? settings.defaultBaselineLoudnessStd,
    baselineVoiceActivityPercent: voiceActivity.mean ?? settings.defaultBaselineVoiceActivityPercent,
    baselineVoiceActivityStd: voiceActivity.std ?? settings.defaultBaselineVoiceActivityStd,
    baselineWordsPer30Sec: wordsPer30Sec.mean ?? settings.defaultBaselineWordsPer30Sec,
    baselineWordsPer30SecStd: wordsPer30Sec.std ?? settings.defaultBaselineWordsPer30SecStd,
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
    baselineIpuLengthSec: data.baselineIpuLengthSec ?? settings.defaultBaselineIpuLengthSec,
    baselineIpuLengthStd: data.baselineIpuLengthStd ?? settings.defaultBaselineIpuLengthStd,
    baselineInterSyllableIntervalSec: data.baselineInterSyllableIntervalSec ?? settings.defaultBaselineInterSyllableIntervalSec,
    baselineInterSyllableIntervalStd: data.baselineInterSyllableIntervalStd ?? settings.defaultBaselineInterSyllableIntervalStd,
    baselinePauseDurationSec: data.baselinePauseDurationSec ?? settings.defaultBaselinePauseDurationSec,
    baselinePauseDurationStd: data.baselinePauseDurationStd ?? settings.defaultBaselinePauseDurationStd,
    baselinePauseFrequencyPerMin: data.baselinePauseFrequencyPerMin ?? settings.defaultBaselinePauseFrequencyPerMin,
    baselinePauseFrequencyStd: data.baselinePauseFrequencyStd ?? settings.defaultBaselinePauseFrequencyStd,
    baselineMeanPitchHz: data.baselineMeanPitchHz ?? settings.defaultBaselineMeanPitchHz,
    baselineMeanPitchStd: data.baselineMeanPitchStd ?? settings.defaultBaselineMeanPitchStd,
    baselineLoudnessDb: data.baselineLoudnessDb ?? settings.defaultBaselineLoudnessDb,
    baselineLoudnessStd: data.baselineLoudnessStd ?? settings.defaultBaselineLoudnessStd,
    baselineVoiceActivityPercent: data.baselineVoiceActivityPercent ?? settings.defaultBaselineVoiceActivityPercent,
    baselineVoiceActivityStd: data.baselineVoiceActivityStd ?? settings.defaultBaselineVoiceActivityStd,
    // Falls back to the population default for a calibration record saved
    // before this field existed -- same graceful-degradation pattern as
    // every other baseline* field above, no storage migration needed.
    baselineWordsPer30Sec: data.baselineWordsPer30Sec ?? settings.defaultBaselineWordsPer30Sec,
    baselineWordsPer30SecStd: data.baselineWordsPer30SecStd ?? settings.defaultBaselineWordsPer30SecStd,
    tachylaliaThreshold: rate * settings.tachylaliaMultiplier,
    isPersonal,
  };
}
