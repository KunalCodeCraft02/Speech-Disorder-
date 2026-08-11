// Hysteresis classification state machine. Ported from
// services/dsp-service/app/pipeline/classifier.py — tachylalia-only:
// bradylalia, disorderMode scoping, and Z_BRADYLALIA/
// HYSTERESIS_WINDOWS_BRADYLALIA are all removed, since a session can now
// only ever monitor speaking-too-fast.

import * as C from './constants';
import type { Settings } from './config';
import type { BaselineProfile } from './baseline';

export type Classification = 'uncalibrated' | 'normal' | 'tachylalia';

export interface ClassificationResult {
  classification: Classification; // confirmed (hysteresis-passed) state
  raw: Classification; // this window's raw label, pre-hysteresis
  confidence: number;
  triggerFeedback: boolean;
  feedbackReason: Classification | null;
  zRate: number;
  zPause: number;
  zSyll: number;
  compositeZ: number;
  // Display-only z-scores (Part D): each feeds only its own param card's
  // color tier, never compositeZ/hysteresis/triggerFeedback.
  zInterSyllableInterval: number;
  zPauseDuration: number;
  zPauseFrequency: number;
  zIpuLength: number;
  zPitch: number;
  zLoudness: number;
  zVoiceActivity: number;
  sampleSufficient: boolean;
}

/** value/baseline can be null when the DSP couldn't estimate this window's parameter (e.g. no voiced frames for pitch) -- 0 is a display placeholder ("no reading"), never treated as "0 deviation". */
function zscore(value: number | null, mean: number, stdDev: number, floor: number, sign = 1): number {
  if (value === null) return 0;
  const denom = Math.max(stdDev, floor);
  return (sign * (value - mean)) / denom;
}

const ZERO_DISPLAY_ZS = {
  zInterSyllableInterval: 0,
  zPauseDuration: 0,
  zPauseFrequency: 0,
  zIpuLength: 0,
  zPitch: 0,
  zLoudness: 0,
  zVoiceActivity: 0,
};

export class HysteresisClassifier {
  private readonly settings: Settings;
  private readonly requiredWindows: number;
  private readonly refractorySec: number;

  private confirmed: Classification = 'normal';
  private rawCounters: Record<Classification, number> = { uncalibrated: 0, normal: 0, tachylalia: 0 };
  private lastFeedbackTime: number | null = null;
  private lastConfidence = 0;

  constructor(settings: Settings, requiredWindows?: number, refractorySec?: number) {
    this.settings = settings;
    this.requiredWindows = Math.max(1, requiredWindows ?? settings.hysteresisWindows);
    this.refractorySec = refractorySec ?? settings.feedbackRefractorySec;
  }

  update(args: {
    articulationRate: number;
    speechToPauseRatio: number | null;
    avgSyllableDurationSec: number | null;
    interSyllableIntervalSec: number | null;
    pauseDurationSec: number | null;
    pauseFrequencyPerMin: number;
    ipuLengthSec: number | null;
    meanPitchHz: number | null;
    loudnessDb: number;
    voiceActivityPercent: number;
    syllablesInWindow: number;
    phonationSecInWindow: number;
    baseline: BaselineProfile | null;
    currentTime: number;
  }): ClassificationResult {
    const {
      articulationRate,
      speechToPauseRatio,
      avgSyllableDurationSec,
      interSyllableIntervalSec,
      pauseDurationSec,
      pauseFrequencyPerMin,
      ipuLengthSec,
      meanPitchHz,
      loudnessDb,
      voiceActivityPercent,
      syllablesInWindow,
      phonationSecInWindow,
      baseline,
      currentTime,
    } = args;

    if (baseline === null) {
      // No calibration at all for this (single, real) patient — never emit
      // tachylalia, and every param card must surface "recalibration
      // needed" rather than a silent 0 (the UI keys this off
      // classification === 'uncalibrated', not off the z value).
      return {
        classification: 'uncalibrated',
        raw: 'uncalibrated',
        confidence: 0,
        triggerFeedback: false,
        feedbackReason: null,
        zRate: 0,
        zPause: 0,
        zSyll: 0,
        compositeZ: 0,
        ...ZERO_DISPLAY_ZS,
        sampleSufficient: false,
      };
    }

    const settings = this.settings;

    const zRate = zscore(articulationRate, baseline.baselineArticulationRate, baseline.baselineArticulationRateStd, settings.baselineStdFloor);
    const zPause = zscore(speechToPauseRatio, baseline.baselinePauseRatio, baseline.baselinePauseRatioStd, C.PAUSE_RATIO_STD_FLOOR);
    // Shorter syllables == faster speech == tachy direction, so the raw
    // sign is flipped to match zRate/zPause's "positive = tachy" convention.
    const zSyll = -zscore(avgSyllableDurationSec, baseline.baselineSyllableDurationSec, baseline.baselineSyllableDurationStd, C.SYLLABLE_DURATION_STD_FLOOR);

    const compositeZ = C.COMPOSITE_Z_WEIGHT_RATE * zRate + C.COMPOSITE_Z_WEIGHT_PAUSE * zPause + C.COMPOSITE_Z_WEIGHT_SYLL * zSyll;

    // Display-only z-scores (Part D/C): each drives only its own param
    // card's color tier. None of these seven feed compositeZ, hysteresis,
    // or triggerFeedback — only zRate/zPause/zSyll above do.
    const displayZs = {
      zInterSyllableInterval: zscore(
        interSyllableIntervalSec,
        baseline.baselineInterSyllableIntervalSec,
        baseline.baselineInterSyllableIntervalStd,
        C.INTER_SYLLABLE_INTERVAL_STD_FLOOR,
        -1
      ),
      zPauseDuration: zscore(pauseDurationSec, baseline.baselinePauseDurationSec, baseline.baselinePauseDurationStd, C.PAUSE_DURATION_STD_FLOOR, -1),
      zPauseFrequency: zscore(
        pauseFrequencyPerMin,
        baseline.baselinePauseFrequencyPerMin,
        baseline.baselinePauseFrequencyStd,
        C.PAUSE_FREQUENCY_STD_FLOOR,
        -1
      ),
      zIpuLength: zscore(ipuLengthSec, baseline.baselineIpuLengthSec, baseline.baselineIpuLengthStd, C.IPU_LENGTH_STD_FLOOR, 1),
      zPitch: zscore(meanPitchHz, baseline.baselineMeanPitchHz, baseline.baselineMeanPitchStd, C.MEAN_PITCH_STD_FLOOR, 1),
      zLoudness: zscore(loudnessDb, baseline.baselineLoudnessDb, baseline.baselineLoudnessStd, C.LOUDNESS_STD_FLOOR, 1),
      zVoiceActivity: zscore(
        voiceActivityPercent,
        baseline.baselineVoiceActivityPercent,
        baseline.baselineVoiceActivityStd,
        C.VOICE_ACTIVITY_STD_FLOOR,
        1
      ),
    };

    const sampleSufficient = syllablesInWindow >= settings.minSyllablesPerWindow && phonationSecInWindow >= settings.minPhonationSecPerWindow;

    if (!sampleSufficient) {
      // A mostly-silent/too-short window must not inject a noisy rate
      // estimate into the decision — carry the previous confirmed state
      // forward untouched, without resetting the hysteresis counters. The
      // seven display-only z's still reflect this window's actual reading
      // (they never feed the decision, so there's nothing to protect them
      // from).
      const reason = this.confirmed !== 'normal' && this.confirmed !== 'uncalibrated' ? this.confirmed : null;
      return {
        classification: this.confirmed,
        raw: this.confirmed,
        confidence: this.lastConfidence,
        triggerFeedback: false,
        feedbackReason: reason,
        zRate,
        zPause,
        zSyll,
        compositeZ,
        ...displayZs,
        sampleSufficient: false,
      };
    }

    // --- Step 1: raw label ---
    let raw: Classification;
    if (baseline.isPersonal) {
      raw = compositeZ > settings.zTachylalia ? 'tachylalia' : 'normal';
    } else {
      raw = articulationRate > baseline.tachylaliaThreshold ? 'tachylalia' : 'normal';
    }

    // --- Step 2: hysteresis confirmation ---
    (Object.keys(this.rawCounters) as Classification[]).forEach((label) => {
      this.rawCounters[label] = label === raw ? this.rawCounters[label] + 1 : 0;
    });

    const progress = Math.min(1, this.rawCounters[raw] / this.requiredWindows);

    let edge = false;
    if (this.rawCounters[raw] >= this.requiredWindows && this.confirmed !== raw) {
      this.confirmed = raw;
      edge = true;
    }

    // --- Step 3: confidence ---
    const direction = raw === 'tachylalia' ? 1 : compositeZ >= 0 ? 1 : -1;
    const components = [zRate, zPause, zSyll];
    const agreeing = components.filter((z) => z * direction > 0).length;
    const corroboration = agreeing / 3;

    const sampleFactor = Math.min(1, syllablesInWindow / (settings.minSyllablesPerWindow * 2));

    const confidence = Math.min(
      1,
      Math.max(
        0,
        C.CONFIDENCE_WEIGHT_PROGRESS * progress +
          C.CONFIDENCE_WEIGHT_CORROBORATION * corroboration +
          C.CONFIDENCE_WEIGHT_COMPOSITE_Z * Math.min(1, Math.abs(compositeZ) / C.CONFIDENCE_COMPOSITE_Z_SCALE) +
          C.CONFIDENCE_WEIGHT_SAMPLE * sampleFactor
      )
    );
    this.lastConfidence = confidence;

    // --- Step 4: feedback (vibration) trigger ---
    let trigger = false;
    let reason: Classification | null = null;
    if (this.confirmed !== 'normal') {
      reason = this.confirmed;
      if (edge) {
        trigger = true;
      } else if (this.lastFeedbackTime === null || currentTime - this.lastFeedbackTime >= this.refractorySec) {
        trigger = true;
      }
    }

    if (trigger) this.lastFeedbackTime = currentTime;

    return {
      classification: this.confirmed,
      raw,
      confidence,
      triggerFeedback: trigger,
      feedbackReason: reason,
      zRate,
      zPause,
      zSyll,
      compositeZ,
      ...displayZs,
      sampleSufficient: true,
    };
  }
}
