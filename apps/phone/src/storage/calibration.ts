// Persists each user's calibration baseline in IndexedDB, keyed by userId
// (storage/users.ts) -- no server, no shared/global calibration. A
// calibration persists across app reloads and logout/login cycles for that
// specific user until they explicitly update it, which overwrites their
// record in place; it never affects any other user's calibration.

import type { BaselineProfile } from '../dsp/baseline';
import { idbGet, idbPut, STORE_CALIBRATIONS } from './db';

export interface CalibrationRecord extends BaselineProfile {
  userId: string;

  baselineSpeechRateWPM: number | null;
  baselineSpeechRatio: number | null;

  durationSec: number | null;
  syllableCount: number | null;
  clipCount: number;

  /** Always 'completed' once a record exists -- a calibration attempt that failed (e.g. too little phonation) never gets this far, see lib/calibrationEngine.ts. */
  status: 'completed';
  /** Set once, when this user's first calibration completes; preserved across later updates. */
  createdAt: string;
  /** Set on every completed calibration, including updates -- this is "when the *active* calibration was produced." */
  updatedAt: string;
  /** Increments on every recalibration — lets the UI/logs tell which calibration pass a session's baseline came from. */
  version: number;
}

export async function getCalibration(userId: string): Promise<CalibrationRecord | null> {
  const record = await idbGet<CalibrationRecord>(STORE_CALIBRATIONS, userId);
  return record ?? null;
}

export async function saveCalibration(userId: string, record: CalibrationRecord): Promise<void> {
  await idbPut(STORE_CALIBRATIONS, record, userId);
}
