import { useEffect, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import type { CalibrationProfile } from '../types';

/**
 * Fetches the patient's calibration profile once per userId. `null` (once
 * loaded) means uncalibrated (Part A.1) -- distinct from `undefined`
 * (still loading), which callers use to gate the "uncalibrated" banner and
 * the pitch-alert's baseline pitch (Part E.13).
 */
export function useCalibrationProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<CalibrationProfile | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setProfile(undefined);

    dataClient
      .getCalibration(userId)
      .then((result) => {
        if (!cancelled) setProfile(result);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return profile;
}
