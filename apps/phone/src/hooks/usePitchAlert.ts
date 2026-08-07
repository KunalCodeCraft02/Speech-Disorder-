import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsUpdateEvent } from '../types';

// Single short tick -- must never reuse the main disorderMode alert's
// pattern ([80,60,80,60,80] / [300,150,300]), so the two are never
// confused for one another (Part E.13).
const PITCH_ALERT_VIBRATION_PATTERN = [50];

// Independent of FEEDBACK_REFRACTORY_SEC (the main alert's cooldown) --
// this is its own cooldown so the two can never spam simultaneously.
const PITCH_ALERT_COOLDOWN_MS = 8000;
const TOAST_VISIBLE_MS = 4000;

/**
 * Part E.13: a general prosody cue, independent of the main
 * tachylalia/bradylalia vibration trigger and not gated on disorderMode.
 * Fires when the patient's mean pitch is both rising (meanPitchTrendHz > 0)
 * and above 1.15x their calibrated baseline, for 2+ consecutive windows.
 */
export function usePitchAlert(frame: MetricsUpdateEvent | null, baselinePitchHz: number | null | undefined) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const consecutiveRef = useRef(0);
  const lastFiredAtRef = useRef(0);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setToastMessage(null);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!frame || baselinePitchHz == null) return;
    const { meanPitchHz, meanPitchTrendHz } = frame;
    if (meanPitchHz == null || meanPitchTrendHz == null) return;

    const threshold = baselinePitchHz * 1.15;
    const exceeds = meanPitchTrendHz > 0 && meanPitchHz > threshold;
    consecutiveRef.current = exceeds ? consecutiveRef.current + 1 : 0;

    if (consecutiveRef.current < 2) return;

    const now = Date.now();
    if (now - lastFiredAtRef.current < PITCH_ALERT_COOLDOWN_MS) return;

    lastFiredAtRef.current = now;
    setToastMessage('Try lowering your tone');
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(PITCH_ALERT_VIBRATION_PATTERN);
    }

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setToastMessage(null), TOAST_VISIBLE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, baselinePitchHz]);

  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  return { toastMessage, dismiss };
}
