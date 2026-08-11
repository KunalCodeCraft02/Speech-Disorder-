import { useCallback, useEffect, useState } from 'react';
import { getCalibration, type CalibrationRecord } from '../storage/calibration';
import { useCurrentUser } from '../context/CurrentUserContext';

/**
 * Reads the signed-in user's calibration baseline from IndexedDB. `null`
 * (once loaded) means this user has never calibrated -- distinct from
 * `undefined` (still loading), which callers use to gate loading states.
 * Re-reads whenever the signed-in user changes (logout -> a different
 * profile logs in), so one user's calibration can never linger and be
 * shown for another.
 */
export function useCalibrationProfile() {
  const { userId } = useCurrentUser();
  const [profile, setProfile] = useState<CalibrationRecord | null | undefined>(undefined);

  const reload = useCallback(() => {
    setProfile(undefined);
    getCalibration(userId)
      .then((result) => setProfile(result))
      .catch(() => setProfile(null));
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { profile, reload };
}
