// Ported from services/dsp-service/app/core/config.py. This is now a
// single-user, on-device app with no env vars — these are plain tunable
// defaults, editable directly in this file (there is no server to
// configure). Bradylalia-specific settings removed (tachylalia-only build).

export interface Settings {
  sampleRate: number;

  analysisWindowSec: number;
  minEmitIntervalSec: number;
  warmupSec: number;

  hysteresisWindows: number;
  /** Minimum continuous real-time (wall-clock, not emit-count) a raw label must persist before it's confirmed -- see classifier.ts. Guards against frame-to-frame flapping independently of how often analyze() happens to emit. */
  hysteresisSustainSec: number;
  /** EMA smoothing factor (0-1, higher = more responsive/less smoothed) applied to compositeZ before it's compared against zTachylalia, so a single loud/fast burst inside an otherwise normal window can't cross the threshold on its own. */
  compositeZSmoothingAlpha: number;

  minSyllablesPerWindow: number;
  minPhonationSecPerWindow: number;

  zTachylalia: number;
  baselineStdFloor: number;

  /** Tone/pitch alert: |zPitch| threshold (already personal-std-normalized -- see classifier.ts) and how long it must stay sustained before the (vibration-free) toast fires. */
  toneAlertZThreshold: number;
  toneAlertSustainSec: number;
  toneAlertSmoothingAlpha: number;
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

  // A raw label must both (a) win `hysteresisWindows` consecutive analyze()
  // emits AND (b) have held continuously for `hysteresisSustainSec` of real
  // recording time before it's confirmed -- (b) is what actually prevents
  // flapping, since emits fire every `minEmitIntervalSec` (0.5s) and 3 of
  // those is only 1.5s of wall-clock confirmation on its own, too fast for
  // a "sustained pattern" classification to feel stable.
  hysteresisWindows: 3,
  hysteresisSustainSec: 3.0,
  compositeZSmoothingAlpha: 0.35,

  // Loosened from the original 4 syll / 1.5s: normal conversational speech
  // pauses within a 4s trailing window often left less than 1.5s of actual
  // phonation, so "Sample OK: No" was showing up far more than the amount
  // of real speech in the window justified.
  minSyllablesPerWindow: 3,
  minPhonationSecPerWindow: 1.0,

  // A single feature moving `zTachylalia` std devs on its own crosses
  // compositeZ's weighted threshold at zTachylalia/weight sigma for that
  // feature alone (e.g. rate-only at weight 0.6 needed ~3.3 sigma at the
  // old zTachylalia=2.0 -- an unrealistically extreme, sustained rate
  // increase). 1.4 keeps compositeZ statistically meaningful (a genuine,
  // multi-feature-corroborated deviation) while reachable by a real,
  // noticeably-fast reading rather than requiring an extreme outlier.
  zTachylalia: 1.4,
  baselineStdFloor: 0.15,

  // |zPitch| already divides by the patient's own calibrated pitch std
  // (with a floor), so this tolerance is inherently personalized -- 1.5
  // sigma is a real, noticeable deviation, not everyday pitch wobble.
  toneAlertZThreshold: 1.5,
  toneAlertSustainSec: 3.0,
  toneAlertSmoothingAlpha: 0.35,
  // Independent of the main tachylalia alert's (edge-triggered) vibration
  // so the two can never spam simultaneously or be mistaken for one another.
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
