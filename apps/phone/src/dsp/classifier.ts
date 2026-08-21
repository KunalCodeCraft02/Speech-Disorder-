// Classification state machine. Ported from
// services/dsp-service/app/pipeline/classifier.py — tachylalia-only:
// bradylalia, disorderMode scoping, and Z_BRADYLALIA/
// HYSTERESIS_WINDOWS_BRADYLALIA are all removed, since a session can now
// only ever monitor speaking-too-fast. The class name/file are kept as
// "hysteresis" for continuity with that port, but `classification` is no
// longer hysteresis-delayed relative to `raw` -- see Step 2's comment in
// update() (item 7: the ring must never lag behind the vibration trigger).

import * as C from './constants';
import type { Settings } from './config';
import type { BaselineProfile } from './baseline';

export type Classification = 'uncalibrated' | 'normal' | 'tachylalia';

export interface ClassificationResult {
  classification: Classification; // == raw for a sample-sufficient window (see update()); carried forward unchanged when a window is skipped
  raw: Classification; // this window's raw label
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
  /** Item 1/6: NOT display-only, unlike the seven above -- condition_2 is `zWordsPer30Sec > settings.zTachylalia`, the same margin condition_1 uses. */
  zWordsPer30Sec: number;
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

  private confirmed: Classification = 'normal';
  /** Cosmetic-only now (item 1/7): feeds confidence's `progress` term, but no longer gates when `confirmed`/triggerFeedback update -- see the Step 1/2 comments below for why the previous multi-window/multi-second hysteresis delay was removed. */
  private rawCounters: Record<Classification, number> = { uncalibrated: 0, normal: 0, tachylalia: 0 };
  private lastConfidence = 0;

  /** Last window's raw (unsmoothed) compositeZ, kept only so the reported `compositeZ` display field doesn't repeat the identical stale number when a window is skipped -- see Step 1: the DECISION itself now always uses this window's own raw compositeZ, not an EMA of it. */
  private lastCompositeZ: number | null = null;
  private rawStreakLabel: Classification | null = null;
  private rawStreakStartTime: number | null = null;

  /** Part F: last time the (now decoupled-from-hysteresis) Haptics alert fired, for the FEEDBACK_REFRACTORY_SEC repeat-while-abnormal cadence. Reset to null once `raw` has genuinely stayed 'normal' for FEEDBACK_EPISODE_GAP_TOLERANCE_SEC (item 3 debounce -- see Step 4), so the next abnormal onset fires immediately, but noisy oscillation right at the boundary can't defeat the cooldown by resetting it on every brief dip. */
  private lastFeedbackFireTime: number | null = null;
  /** item 3: last window's time where `raw` was 'tachylalia' -- see Step 4. */
  private lastTachyRawTime: number | null = null;

  constructor(settings: Settings, requiredWindows?: number) {
    this.settings = settings;
    this.requiredWindows = Math.max(1, requiredWindows ?? settings.hysteresisWindows);
    this.sustainSec = Math.max(0, settings.hysteresisSustainSec);
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
    loudnessDb: number | null;
    voiceActivityPercent: number;
    wordsPerLast30Sec: number;
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
      wordsPerLast30Sec,
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
        zWordsPer30Sec: 0,
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
    // Item 1/6: condition_2's own z, against the patient's calibrated
    // baselineWordsPer30Sec/-Std (baseline.ts) -- NOT display-only (see the
    // ClassificationResult field doc comment), computed here alongside
    // zRate/zPause/zSyll rather than in `displayZs` below.
    const zWordsPer30Sec = zscore(wordsPerLast30Sec, baseline.baselineWordsPer30Sec, baseline.baselineWordsPer30SecStd, C.WORDS_PER_30SEC_STD_FLOOR);

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
        zWordsPer30Sec,
        // Report the last real reading rather than this (unreliable,
        // low-sample) window's fresh compositeZ, so the displayed value
        // doesn't jump around during a low-phonation window.
        compositeZ: this.lastCompositeZ ?? compositeZ,
        ...displayZs,
        sampleSufficient: false,
      };
    }

    this.lastCompositeZ = compositeZ;

    // --- Step 1: raw label (Part D) ---
    // Two independent conditions, either sufficient on its own -- both now
    // measured as a margin above THIS patient's own calibrated baseline
    // (item 1), using the SAME zTachylalia margin (item 6: one number
    // drives both the decision and the two-color param-card display, so
    // they can never disagree):
    //   condition_1 = compositeZ > zTachylalia (rate/pause/syllable-duration
    //     composite, or the fixed-multiplier fallback when there's no
    //     personal std yet)
    //   condition_2 = zWordsPer30Sec > zTachylalia (wordsPerLast30Sec
    //     against the patient's own calibrated baselineWordsPer30Sec/-Std --
    //     was a fixed population number independent of calibration; catches
    //     a patient whose own baseline rate is already fast, where
    //     condition_1 alone could stay quiet even at a genuinely abnormal
    //     absolute rate, but personalized like condition_1 rather than a
    //     population cutoff that fired on ordinary calibrated-normal speech)
    //
    // Both use THIS window's own raw z, not an EMA of it -- an EMA-smoothed
    // value takes several windows (seconds) to catch up to a real step
    // change, which was exactly the "still buzzes noticeably late" bug. The
    // EMA's original purpose (a single noisy window can't cross the
    // threshold alone) is now covered upstream instead: sampleSufficient
    // (above) already requires a real amount of speech in this window, and
    // preprocessing.ts/vad.ts's strengthened noise rejection (item 2) means
    // a noise-only window is far less likely to produce an inflated rate/z
    // in the first place.
    const condition1 = baseline.isPersonal ? compositeZ > settings.zTachylalia : articulationRate > baseline.tachylaliaThreshold;
    const condition2 = zWordsPer30Sec > settings.zTachylalia;
    const raw: Classification = condition1 || condition2 ? 'tachylalia' : 'normal';

    // Streak bookkeeping kept purely for confidence's `progress` term below
    // (item 1/7: it no longer gates `confirmed`/triggerFeedback -- see Step
    // 2).
    (Object.keys(this.rawCounters) as Classification[]).forEach((label) => {
      this.rawCounters[label] = label === raw ? this.rawCounters[label] + 1 : 0;
    });

    if (this.rawStreakLabel !== raw) {
      this.rawStreakLabel = raw;
      this.rawStreakStartTime = currentTime;
    }
    const sustainedSec = this.rawStreakStartTime !== null ? currentTime - this.rawStreakStartTime : 0;
    const progress = Math.min(1, Math.min(this.rawCounters[raw] / this.requiredWindows, this.sustainSec > 0 ? sustainedSec / this.sustainSec : 1));

    // --- Step 2: classification update (item 7) ---
    // `confirmed` (the ring/badge) now updates unconditionally to `raw`
    // every sample-sufficient window -- the SAME window and the SAME `raw`
    // value that Step 4 below uses to decide the vibration. Previously
    // `confirmed` only changed after `requiredWindows` consecutive
    // same-raw emits AND `sustainSec` of continuous real time, while
    // Step 4's trigger fired immediately -- that mismatch was exactly the
    // "ring stays Normal for a period after TACHYLALIA is confirmed and
    // vibration has already fired" bug. There is deliberately no separate,
    // delayed confirmation path left: ring and vibration are two views of
    // the same `raw` value in the same call.
    this.confirmed = raw;

    // --- Step 3: confidence --- (still uses the streak/progress signal
    // above as one input, but that no longer blocks classification itself)
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

    // --- Step 4: feedback (vibration) trigger (Part F, item 3 debounce) ---
    // Fires on the FIRST window where condition_1 OR condition_2 is true
    // (same `raw`, same window as Step 2's classification update above --
    // item 7), then re-fires every FEEDBACK_REFRACTORY_SEC while the
    // episode continues.
    //
    // "Continues" is judged with a short gap tolerance
    // (FEEDBACK_EPISODE_GAP_TOLERANCE_SEC), not a strict single-window
    // flip to 'normal': noisy oscillation right at the boundary used to
    // reset `lastFeedbackFireTime` on every dip below threshold, so the
    // very next crossing back above fired an immediate re-buzz -- the
    // refractory cooldown was defeated by flapping instead of throttling
    // it. Only once `raw` has genuinely stayed 'normal' for longer than the
    // gap tolerance does the cooldown reset, so a real new onset after a
    // real recovery still fires immediately (unaffected by this change --
    // see classification/`this.confirmed` in Step 2, which is NOT subject
    // to this tolerance and reverts to NORMAL the instant `raw` does,
    // exactly as before).
    let trigger = false;
    if (raw === 'tachylalia') {
      if (this.lastFeedbackFireTime === null || currentTime - this.lastFeedbackFireTime >= C.FEEDBACK_REFRACTORY_SEC) {
        trigger = true;
        this.lastFeedbackFireTime = currentTime;
      }
      this.lastTachyRawTime = currentTime;
    } else if (this.lastTachyRawTime === null || currentTime - this.lastTachyRawTime >= C.FEEDBACK_EPISODE_GAP_TOLERANCE_SEC) {
      this.lastFeedbackFireTime = null;
    }
    const reason: Classification | null = trigger ? 'tachylalia' : null;

    return {
      classification: this.confirmed,
      raw,
      confidence,
      triggerFeedback: trigger,
      feedbackReason: reason,
      zRate,
      zPause,
      zSyll,
      zWordsPer30Sec,
      compositeZ,
      ...displayZs,
      sampleSufficient: true,
    };
  }
}
