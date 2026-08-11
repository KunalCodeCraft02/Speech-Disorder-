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
  private readonly sustainSec: number;
  private readonly smoothingAlpha: number;

  private confirmed: Classification = 'normal';
  private rawCounters: Record<Classification, number> = { uncalibrated: 0, normal: 0, tachylalia: 0 };
  private lastConfidence = 0;

  /** EMA of compositeZ (Part 17/1): a single fast/loud burst inside an otherwise normal window shouldn't be able to cross zTachylalia on its own -- only a sustained elevation should. */
  private smoothedCompositeZ: number | null = null;
  private rawStreakLabel: Classification | null = null;
  private rawStreakStartTime: number | null = null;

  constructor(settings: Settings, requiredWindows?: number) {
    this.settings = settings;
    this.requiredWindows = Math.max(1, requiredWindows ?? settings.hysteresisWindows);
    this.sustainSec = Math.max(0, settings.hysteresisSustainSec);
    this.smoothingAlpha = Math.min(1, Math.max(0, settings.compositeZSmoothingAlpha));
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
        // Report the last smoothed reading rather than this (unreliable,
        // low-sample) window's raw compositeZ, so the displayed value
        // doesn't jump around during a low-phonation window.
        compositeZ: this.smoothedCompositeZ ?? compositeZ,
        ...displayZs,
        sampleSufficient: false,
      };
    }

    // Smooth compositeZ (EMA) before it's used for the decision -- only on
    // sample-sufficient windows, since a low-syllable window's compositeZ
    // is itself a noisy estimate not worth folding in.
    this.smoothedCompositeZ = this.smoothedCompositeZ === null ? compositeZ : this.smoothedCompositeZ + this.smoothingAlpha * (compositeZ - this.smoothedCompositeZ);
    const smoothedCompositeZ = this.smoothedCompositeZ;

    // --- Step 1: raw label ---
    let raw: Classification;
    if (baseline.isPersonal) {
      raw = smoothedCompositeZ > settings.zTachylalia ? 'tachylalia' : 'normal';
    } else {
      raw = articulationRate > baseline.tachylaliaThreshold ? 'tachylalia' : 'normal';
    }

    // --- Step 2: hysteresis confirmation ---
    // Two independent guards against flapping: `requiredWindows` consecutive
    // same-raw emits (as before), AND the raw label must have held
    // continuously for `sustainSec` of real recording time -- emits fire
    // every ~0.5s, so a pure emit-count floor alone confirms a state change
    // in as little as ~1.5s, too fast to read as "sustained."
    (Object.keys(this.rawCounters) as Classification[]).forEach((label) => {
      this.rawCounters[label] = label === raw ? this.rawCounters[label] + 1 : 0;
    });

    if (this.rawStreakLabel !== raw) {
      this.rawStreakLabel = raw;
      this.rawStreakStartTime = currentTime;
    }
    const sustainedSec = this.rawStreakStartTime !== null ? currentTime - this.rawStreakStartTime : 0;

    const progress = Math.min(1, Math.min(this.rawCounters[raw] / this.requiredWindows, this.sustainSec > 0 ? sustainedSec / this.sustainSec : 1));

    let edge = false;
    if (this.rawCounters[raw] >= this.requiredWindows && sustainedSec >= this.sustainSec && this.confirmed !== raw) {
      this.confirmed = raw;
      edge = true;
    }

    // --- Step 3: confidence --- (uses the smoothed composite so one noisy
    // window can't also swing confidence, matching the decision above)
    const direction = raw === 'tachylalia' ? 1 : smoothedCompositeZ >= 0 ? 1 : -1;
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
          C.CONFIDENCE_WEIGHT_COMPOSITE_Z * Math.min(1, Math.abs(smoothedCompositeZ) / C.CONFIDENCE_COMPOSITE_Z_SCALE) +
          C.CONFIDENCE_WEIGHT_SAMPLE * sampleFactor
      )
    );
    this.lastConfidence = confidence;

    // --- Step 4: feedback (vibration) trigger ---
    // Strictly edge-triggered: fires exactly once on the NORMAL->TACHYLALIA
    // transition (`edge` is only true the instant `this.confirmed` changes
    // -- see Step 2), never while the state merely persists, and never
    // again until a return to 'normal' followed by a fresh transition back
    // to 'tachylalia'. A periodic "also re-fire every few seconds while
    // still abnormal" branch used to live here; combined with how sticky
    // the smoothed/hysteresis-confirmed state can be, it produced
    // vibration that felt continuous and disconnected from the patient's
    // actual current speech -- removed rather than just tuned, since the
    // bug was the repeat-while-steady-state behavior itself, not its
    // timing.
    const trigger = edge && this.confirmed !== 'normal';
    const reason = trigger ? this.confirmed : null;

    return {
      classification: this.confirmed,
      raw,
      confidence,
      triggerFeedback: trigger,
      feedbackReason: reason,
      zRate,
      zPause,
      zSyll,
      compositeZ: smoothedCompositeZ,
      ...displayZs,
      sampleSufficient: true,
    };
  }
}
