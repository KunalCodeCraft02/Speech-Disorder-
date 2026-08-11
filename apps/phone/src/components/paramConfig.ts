// The 10 monitored parameters (Part B/C/D) — one entry per param card,
// shared by the Main screen's ParamGrid and (for baseline bands) the
// Analytics tab. `feedsComposite` is display metadata only: it never
// changes how a card is colored, it just labels which 3 params actually
// drive compositeZ/TACHYLALIA so a red card on a `feedsComposite: false`
// param is legible as "unusual, not a trigger."
import type { MetricsFrame } from '../dsp/sessionPipeline';

export type ParamKey =
  | 'rate'
  | 'pause'
  | 'syll'
  | 'isi'
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
    key: 'syll',
    label: 'Syllable Duration',
    shortLabel: 'Syll. Duration',
    unit: 's',
    digits: 3,
    feedsComposite: true,
    value: (f) => f.averageSyllableDurationSec,
    z: (f) => f.zSyll,
  },
  {
    key: 'isi',
    label: 'Inter-Syllable Interval',
    shortLabel: 'Inter-Syll.',
    unit: 's',
    digits: 3,
    feedsComposite: false,
    value: (f) => f.interSyllableIntervalSec,
    z: (f) => f.zInterSyllableInterval,
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
    unit: 'dB',
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
