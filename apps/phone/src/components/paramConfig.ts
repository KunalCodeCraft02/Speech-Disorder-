// The main-screen monitored parameters (Part B/C/D) — one entry per param
// card, shared by the Main screen's ParamGrid and (for baseline bands) the
// Analytics tab. Pause Duration and Pause Frequency were removed from this
// grid (item 6) -- both are still computed (features.ts/classifier.ts) and
// shown in SecondaryMetricsPanel's detailed view. `feedsComposite` is
// display metadata only: it never changes how a card is colored, it just
// labels which 3 params actually drive compositeZ/TACHYLALIA so a red card
// on a `feedsComposite: false` param is legible as "unusual, not a
// trigger."
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { settings } from '../dsp/config';

export type ParamKey = 'rate' | 'pause' | 'wpm' | 'words30' | 'ipuLength' | 'pitch' | 'loudness' | 'voiceActivity';

export interface ParamDef {
  key: ParamKey;
  label: string;
  shortLabel: string;
  unit: string;
  digits: number;
  feedsComposite: boolean;
  value: (f: MetricsFrame) => number | null;
  z: (f: MetricsFrame) => number;
}

export const PARAMS: ParamDef[] = [
  {
    key: 'rate',
    label: 'Articulation Rate',
    shortLabel: 'Artic. Rate',
    unit: 'syll/s',
    digits: 2,
    feedsComposite: true,
    value: (f) => f.articulationRateSPS,
    z: (f) => f.zRate,
  },
  {
    key: 'pause',
    label: 'Speech:Pause Ratio',
    shortLabel: 'Speech:Pause',
    unit: '',
    digits: 2,
    feedsComposite: true,
    value: (f) => f.speechToPauseRatio,
    z: (f) => f.zPause,
  },
  {
    // Live WPM (Part H) -- same underlying signal as Articulation Rate in
    // different units, so it reuses zRate for its color tier rather than
    // inventing a second baseline for what is effectively the same
    // measurement expressed as words/min. feedsComposite is still false
    // here: compositeZ is computed from articulationRateSPS, not this
    // derived value.
    key: 'wpm',
    label: 'Speech Rate (WPM)',
    shortLabel: 'WPM',
    unit: 'wpm',
    digits: 0,
    feedsComposite: false,
    value: (f) => f.speechRateWPM,
    z: (f) => f.zRate,
  },
  {
    // Part H/D, item 1/6: condition_2's own raw trigger input in
    // classifier.ts (zWordsPer30Sec > zTachylalia, against this patient's
    // calibrated baselineWordsPer30Sec/-Std -- baseline.ts). Colored the
    // same two-color way as every other card now, off that same z.
    key: 'words30',
    label: 'Words / 30 sec',
    shortLabel: 'Words/30s',
    unit: '',
    digits: 0,
    feedsComposite: false,
    value: (f) => f.wordsPerLast30Sec,
    z: (f) => f.zWordsPer30Sec,
  },
  {
    key: 'ipuLength',
    label: 'IPU Length',
    shortLabel: 'IPU Length',
    unit: 's',
    digits: 2,
    feedsComposite: false,
    value: (f) => f.interPausalUnitLengthSec,
    z: (f) => f.zIpuLength,
  },
  {
    key: 'pitch',
    label: 'Mean Pitch',
    shortLabel: 'Pitch',
    unit: 'Hz',
    digits: 0,
    feedsComposite: false,
    value: (f) => f.meanPitchHz,
    z: (f) => f.zPitch,
  },
  {
    key: 'loudness',
    label: 'Loudness',
    shortLabel: 'Loudness',
    // Pre-AGC dBFS-style relative energy (0 dBFS ~= digital full scale),
    // not a calibrated microphone-relative SPL reading -- see
    // preprocessing.ts's StreamingSpectralDenoiser.process() and
    // features.ts's windowedLoudnessDb() doc comments.
    unit: 'dBFS',
    digits: 1,
    feedsComposite: false,
    value: (f) => f.loudnessDb,
    z: (f) => f.zLoudness,
  },
  {
    key: 'voiceActivity',
    label: 'Voice Activity',
    shortLabel: 'Voice Act.',
    unit: '%',
    digits: 0,
    feedsComposite: false,
    value: (f) => f.voiceActivityPercent,
    z: (f) => f.zVoiceActivity,
  },
];

// Item 6: two-color only -- no amber/middle tier. `abnormal` fires at
// exactly the same margin (settings.zTachylalia) as the classifier's own
// condition_1/condition_2 decision (classifier.ts), imported directly
// rather than a separate hardcoded number so the display can never drift
// out of sync with what actually triggers TACHYLALIA.
export type Tier = 'uncalibrated' | 'normal' | 'abnormal';

/** |z| >= zTachylalia -> red ('abnormal'), otherwise neutral/white ('normal'). Color only — never itself a trigger (that's compositeZ/zWordsPer30Sec vs. zTachylalia in classifier.ts); see ParamGrid's doc comment. */
export function tierForZ(z: number, calibrated: boolean): Tier {
  if (!calibrated) return 'uncalibrated';
  return Math.abs(z) >= settings.zTachylalia ? 'abnormal' : 'normal';
}
