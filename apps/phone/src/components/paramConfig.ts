// The 10 monitored parameters (Part B/C/D) — one entry per param card,
// shared by the Main screen's ParamGrid and (for baseline bands) the
// Analytics tab. `feedsComposite` is display metadata only: it never
// changes how a card is colored, it just labels which 3 params actually
// drive compositeZ/TACHYLALIA so a red card on a `feedsComposite: false`
// param is legible as "unusual, not a trigger."
import type { MetricsFrame } from '../dsp/sessionPipeline';
import * as C from '../dsp/constants';

export type ParamKey =
  | 'rate'
  | 'pause'
  | 'wpm'
  | 'words30'
  | 'pauseDuration'
  | 'pauseFrequency'
  | 'ipuLength'
  | 'pitch'
  | 'loudness'
  | 'voiceActivity';

export interface ParamDef {
  key: ParamKey;
  label: string;
  shortLabel: string;
  unit: string;
  digits: number;
  feedsComposite: boolean;
  value: (f: MetricsFrame) => number | null;
  z: (f: MetricsFrame) => number;
  /** Optional override: Words/30s (Part H) is colored against the fixed population reference range (constants.ts), not a personal-baseline z-score -- when present, this replaces the default tierForZ(z, ...) for this card. */
  tier?: (f: MetricsFrame) => Tier;
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
    // Part H/D: a live population-reference metric -- also condition_2's
    // raw trigger input in classifier.ts (wordsPerLast30Sec > the normal
    // range's upper bound). Colored against the fixed population range,
    // not a personal z-score -- see `tier` below.
    key: 'words30',
    label: 'Words / 30 sec',
    shortLabel: 'Words/30s',
    unit: '',
    digits: 0,
    feedsComposite: false,
    value: (f) => f.wordsPerLast30Sec,
    z: () => 0,
    tier: (f) => {
      const value = f.wordsPerLast30Sec;
      if (value > C.WORDS_PER_30SEC_NORMAL_MAX) return 'abnormal';
      if (value < C.WORDS_PER_30SEC_NORMAL_MIN) return 'elevated';
      return 'normal';
    },
  },
  {
    key: 'pauseDuration',
    label: 'Pause Duration',
    shortLabel: 'Pause Dur.',
    unit: 's',
    digits: 2,
    feedsComposite: false,
    value: (f) => f.pauseDurationSec,
    z: (f) => f.zPauseDuration,
  },
  {
    key: 'pauseFrequency',
    label: 'Pause Frequency',
    shortLabel: 'Pause Freq.',
    unit: '/min',
    digits: 1,
    feedsComposite: false,
    value: (f) => f.pauseFrequencyPerMin,
    z: (f) => f.zPauseFrequency,
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
    // dBFS-style relative energy level from the VAD's frame energy
    // estimate (0 dBFS ~= digital full scale), not a calibrated
    // microphone-relative SPL reading -- see features.ts's
    // windowedLoudnessDb() doc comment.
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

export type Tier = 'uncalibrated' | 'normal' | 'elevated' | 'abnormal';

/** |z| < 1 normal, 1–2 amber "elevated", >= 2 red "abnormal" (Part D). Color only — never a trigger; see ParamCard's doc comment. */
export function tierForZ(z: number, calibrated: boolean): Tier {
  if (!calibrated) return 'uncalibrated';
  const abs = Math.abs(z);
  if (abs >= 2.0) return 'abnormal';
  if (abs >= 1.0) return 'elevated';
  return 'normal';
}
