// Ported from services/dsp-service/app/core/config.py. This is now a
// single-user, on-device app with no env vars — these are plain tunable
// defaults, editable directly in this file (there is no server to
// configure). Bradylalia-specific settings removed (tachylalia-only build).

export interface Settings {
  sampleRate: number;

  analysisWindowSec: number;
  minEmitIntervalSec: number;
  warmupSec: number;

  /** Cosmetic only (item 1/7 removed these as a gate on `classification`/triggerFeedback, which now update immediately from `raw` every sample-sufficient window -- see classifier.ts's update()). Still feeds confidence's `progress` term: how many consecutive same-raw windows, and how long continuously, the current raw label has held. */
  hysteresisWindows: number;
  hysteresisSustainSec: number;

  minSyllablesPerWindow: number;
  minPhonationSecPerWindow: number;

  zTachylalia: number;
  baselineStdFloor: number;

  /** Tone alert: fixed absolute loudness threshold (constants.ts's LOUDNESS_THRESHOLD_DBFS -- not personal-baseline-relative), not pitch (removed per the pitch->loudness-only redesign). How long it must stay sustained during actual VAD-confirmed speech before it fires, and its own cooldown -- independent of the main tachylalia alert's cooldown/refractory. */
  toneAlertSustainSec: number;
  toneAlertCooldownSec: number;
  toneAlertToastVisibleSec: number;

  // Population defaults — used only if a caller explicitly opts into a
  // demo/no-calibration baseline. There is no "demoMode" fallback wired
  // into the live app anymore (single real user, calibration is always
  // required — see baseline.ts), but the constants stay available for the
  // calibration-clip analysis path's descriptive fallback.
  defaultBaselineArticulationRate: number;
  defaultBaselineArticulationRateStd: number;
  defaultBaselinePauseRatio: number;
  defaultBaselinePauseRatioStd: number;
  defaultBaselineSyllableDurationSec: number;
  defaultBaselineSyllableDurationStd: number;
  defaultBaselineInterSyllableIntervalSec: number;
  defaultBaselineInterSyllableIntervalStd: number;
  defaultBaselinePauseDurationSec: number;
  defaultBaselinePauseDurationStd: number;
  defaultBaselinePauseFrequencyPerMin: number;
  defaultBaselinePauseFrequencyStd: number;
  defaultBaselineIpuLengthSec: number;
  defaultBaselineIpuLengthStd: number;
  defaultBaselineMeanPitchHz: number;
  defaultBaselineMeanPitchStd: number;
  defaultBaselineLoudnessDb: number;
  defaultBaselineLoudnessStd: number;
  defaultBaselineVoiceActivityPercent: number;
  defaultBaselineVoiceActivityStd: number;
  /** Item 1/6: population fallback for condition_2's now-personalized baseline (used only pre-calibration/no-personal-std, same as the other defaultBaseline* fields). */
  defaultBaselineWordsPer30Sec: number;
  defaultBaselineWordsPer30SecStd: number;

  tachylaliaMultiplier: number;

  minCalibrationPhonationSec: number;
  calibrationSubwindowSec: number;
}

export const settings: Settings = {
  sampleRate: 16000,

  analysisWindowSec: 4.0,
  minEmitIntervalSec: 0.5,
  warmupSec: 1.0,

  // Cosmetic-only (see the Settings interface doc comment above) --
  // confidence's `progress` term ramps up over `hysteresisWindows`
  // consecutive same-raw emits and `hysteresisSustainSec` of continuous
  // real time, but neither gates the classification or vibration
  // themselves anymore.
  hysteresisWindows: 3,
  hysteresisSustainSec: 3.0,

  // Loosened from the original 4 syll / 1.5s: normal conversational speech
  // pauses within a 4s trailing window often left less than 1.5s of actual
  // phonation, so "Sample OK: No" was showing up far more than the amount
  // of real speech in the window justified.
  minSyllablesPerWindow: 3,
  minPhonationSecPerWindow: 1.0,

  // The single shared margin above the patient's calibrated baseline for
  // BOTH trigger conditions (item 1/6):
  //   condition_1: compositeZ > zTachylalia (this window's own raw
  //     compositeZ, not smoothed -- the alert fires the window the
  //     threshold is actually crossed, see classifier.ts's Step 1 comment)
  //   condition_2: zWordsPer30Sec > zTachylalia (wordsPerLast30Sec
  //     measured against the patient's own calibrated
  //     baselineWordsPer30Sec/-Std -- see baseline.ts -- not the fixed
  //     population number this used to be)
  // This is also the exact cutoff the two-color param-card display uses
  // (item 6: |z| >= zTachylalia -> red, otherwise neutral/white) -- one
  // number drives both the decision and its own display, so they can never
  // silently disagree.
  //
  // History: was progressively LOWERED (2.0 -> 1.4 -> 1.1 -> 1.0) across
  // earlier tuning passes chasing under-sensitivity, but 1.0 combined with
  // per-window (unsmoothed) evaluation proved too trigger-happy on real
  // calibrated-normal speech -- widened to 2.0, which then over-corrected
  // the other direction (patient had to speak unrealistically fast to
  // trigger at all). 1.5 sits at the midpoint: a smaller margin than 2.0,
  // but well clear of the 1.0 that proved too sensitive. The
  // anti-false-trigger guard against noise is upstream (sampleSufficient +
  // preprocessing.ts/vad.ts/sessionPipeline.ts's noise/VAD-confirmation
  // gating, item 2/8), not this margin -- widen or narrow this specifically
  // to tune how far a genuine, sustained deviation from the patient's own
  // baseline must go before it counts as abnormal, and validate against
  // real session data (normal-pace AND genuinely-fast recordings) before
  // treating a new value as final.
  zTachylalia: 1.5,
  baselineStdFloor: 0.15,

  toneAlertSustainSec: 3.0,
  // Independent of the main tachylalia alert's own refractory cadence
  // (FEEDBACK_REFRACTORY_SEC) so the two can never be mistaken for one
  // another -- distinct vibration patterns too, see haptics.ts.
  toneAlertCooldownSec: 6.0,
  toneAlertToastVisibleSec: 4.0,

  defaultBaselineArticulationRate: 4.4,
  defaultBaselineArticulationRateStd: 0.6,
  defaultBaselinePauseRatio: 1.5,
  defaultBaselinePauseRatioStd: 0.6,
  defaultBaselineSyllableDurationSec: 0.2,
  defaultBaselineSyllableDurationStd: 0.05,
  defaultBaselineInterSyllableIntervalSec: 0.22,
  defaultBaselineInterSyllableIntervalStd: 0.05,
  defaultBaselinePauseDurationSec: 0.6,
  defaultBaselinePauseDurationStd: 0.2,
  defaultBaselinePauseFrequencyPerMin: 12,
  defaultBaselinePauseFrequencyStd: 4,
  defaultBaselineIpuLengthSec: 1.0,
  defaultBaselineIpuLengthStd: 0.3,
  defaultBaselineMeanPitchHz: 150,
  defaultBaselineMeanPitchStd: 20,
  defaultBaselineLoudnessDb: -20,
  defaultBaselineLoudnessStd: 4,
  defaultBaselineVoiceActivityPercent: 60,
  defaultBaselineVoiceActivityStd: 10,
  // Derived from defaultBaselineArticulationRate the same way
  // baseline.ts derives a real patient's baselineWordsPer30Sec from their
  // calibrated speechRateWPM (words/30s = WPM/2).
  defaultBaselineWordsPer30Sec: (4.4 * 60) / 1.4 / 2,
  defaultBaselineWordsPer30SecStd: (0.6 * 60) / 1.4 / 2,

  // Fallback-only (no personal std yet): 25% above the patient's own
  // measured baseline rate is a realistic "noticeably rushed" bar, vs. the
  // old 1.55x (55% faster) which effectively never fired in practice.
  tachylaliaMultiplier: 1.25,

  minCalibrationPhonationSec: 20.0,
  calibrationSubwindowSec: 4.0,
};
