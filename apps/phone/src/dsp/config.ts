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

  /** Tone alert: fixed absolute loudness threshold (constants.ts's LOUDNESS_ALERT_DBFS_THRESHOLD -- not personal-baseline-relative), not pitch (removed per the pitch->loudness-only redesign). How long it must stay sustained during actual VAD-confirmed speech before it fires, and its own cooldown -- independent of the main tachylalia alert's cooldown/refractory. */
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

  // A single feature moving `zTachylalia` std devs on its own crosses
  // compositeZ's weighted threshold at zTachylalia/weight sigma for that
  // feature alone (e.g. rate-only at weight 0.6 needed ~3.3 sigma at the
  // original zTachylalia=2.0 -- an unrealistically extreme, sustained rate
  // increase). Progressively lowered (2.0 -> 1.4 -> 1.1 -> 1.0) to sit
  // closer to the patient's own calibrated baseline: speechToPauseRatio
  // used to be a session-cumulative ratio that could drift and inflate
  // z_pause on its own (see features.ts's windowedPauseSec), which was
  // quietly helping borderline-fast speech cross the higher thresholds; now
  // that z_pause is properly windowed and no longer contributes that
  // spurious lift, 1.0 (rate-only now needs ~1.7 sigma alone) is reachable
  // by a real, moderately-fast, sustained reading without going back to
  // flagging everyday variation. (condition_2 in classifier.ts --
  // wordsPerLast30Sec > the population upper bound -- is an independent,
  // non-z-score trigger; see constants.ts's
  // WORDS_PER_30SEC_TACHYLALIA_THRESHOLD.) Note this now compares against
  // THIS window's own raw compositeZ, not an EMA of it (item 1 -- the alert
  // must fire on the window the threshold is actually crossed), so a single
  // sample-sufficient window genuinely can trigger condition_1 on its own;
  // the anti-false-trigger guard against noise is now upstream, in
  // sampleSufficient (this window must actually have real phonation) and
  // preprocessing.ts/vad.ts/sessionPipeline.ts's noise/VAD-confirmation
  // gating (item 2/8), not temporal smoothing of the decision. Tunable:
  // change this constant to retune sensitivity, and validate against real
  // session data before treating a new value as final.
  zTachylalia: 1.0,
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

  // Fallback-only (no personal std yet): 25% above the patient's own
  // measured baseline rate is a realistic "noticeably rushed" bar, vs. the
  // old 1.55x (55% faster) which effectively never fired in practice.
  tachylaliaMultiplier: 1.25,

  minCalibrationPhonationSec: 20.0,
  calibrationSubwindowSec: 4.0,
};
