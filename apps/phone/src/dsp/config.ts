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
  feedbackRefractorySec: number;

  minSyllablesPerWindow: number;
  minPhonationSecPerWindow: number;

  zTachylalia: number;
  baselineStdFloor: number;

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

  tachylaliaMultiplier: number;

  minCalibrationPhonationSec: number;
  calibrationSubwindowSec: number;
}

export const settings: Settings = {
  sampleRate: 16000,

  analysisWindowSec: 4.0,
  minEmitIntervalSec: 0.5,
  warmupSec: 1.0,

  hysteresisWindows: 3,
  feedbackRefractorySec: 4.0,

  minSyllablesPerWindow: 4,
  minPhonationSecPerWindow: 1.5,

  zTachylalia: 2.0,
  baselineStdFloor: 0.15,

  defaultBaselineArticulationRate: 4.4,
  defaultBaselineArticulationRateStd: 0.6,
  defaultBaselinePauseRatio: 1.5,
  defaultBaselinePauseRatioStd: 0.6,
  defaultBaselineSyllableDurationSec: 0.2,
  defaultBaselineSyllableDurationStd: 0.05,

  tachylaliaMultiplier: 1.55,

  minCalibrationPhonationSec: 20.0,
  calibrationSubwindowSec: 4.0,
};
