import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { toneAlertHaptic } from '../lib/haptics';

// Independent of FEEDBACK_REFRACTORY_SEC (the main alert's 4.0s cooldown) --
// this is its own 6.0s cooldown so the two can never spam simultaneously,
// and toneAlertHaptic() never shares a call site with mainAlertHaptic().
const PITCH_ALERT_COOLDOWN_MS = 6000;
const TOAST_VISIBLE_MS = 4000;

/**
 * A general prosody cue, independent of the main tachylalia vibration
 * trigger. Fires when the patient's mean pitch is both rising
 * (meanPitchTrendHz > 0) and above 1.15x their calibrated baseline, for 2+
 * consecutive windows.
 */
export function usePitchAlert(frame: MetricsFrame | null, baselinePitchHz: number | null | undefined) {
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
    void toneAlertHaptic();

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setToastMessage(null), TOAST_VISIBLE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, baselinePitchHz]);

  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  return { toastMessage, dismiss };
}
