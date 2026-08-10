import { useCallback, useEffect, useState } from 'react';
import { getCalibration, type CalibrationRecord } from '../storage/calibration';

/**
 * Reads the on-device calibration baseline from IndexedDB. `null` (once
 * loaded) means uncalibrated — distinct from `undefined` (still loading),
 * which callers use to gate the "uncalibrated" banner and the pitch
 * alert's baseline pitch.
 */
export function useCalibrationProfile() {
  const [profile, setProfile] = useState<CalibrationRecord | null | undefined>(undefined);

  const reload = useCallback(() => {
    setProfile(undefined);
    getCalibration()
      .then((result) => setProfile(result))
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { profile, reload };
}
