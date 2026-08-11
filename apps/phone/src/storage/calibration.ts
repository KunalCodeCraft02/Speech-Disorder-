// Persists the patient's calibration baseline in IndexedDB — no server,
// no Profile document. Calibration persists across app reloads until the
// user explicitly recalibrates, which overwrites this record in place.

import type { BaselineProfile } from '../dsp/baseline';
import { CALIBRATION_KEY, idbDelete, idbGet, idbPut, STORE_CALIBRATION } from './db';

export interface CalibrationRecord extends BaselineProfile {
  baselineSpeechRateWPM: number | null;
  baselineSpeechRatio: number | null;

  durationSec: number | null;
  syllableCount: number | null;
  clipCount: number;

  calibratedAt: string;
  /** Increments on every recalibration — lets the UI/logs tell which calibration pass a session's baseline came from. */
  version: number;
}

export async function getCalibration(): Promise<CalibrationRecord | null> {
  const record = await idbGet<CalibrationRecord>(STORE_CALIBRATION, CALIBRATION_KEY);
  return record ?? null;
}

export async function saveCalibration(record: CalibrationRecord): Promise<void> {
  await idbPut(STORE_CALIBRATION, record, CALIBRATION_KEY);
}

export async function clearCalibration(): Promise<void> {
  await idbDelete(STORE_CALIBRATION, CALIBRATION_KEY);
}
