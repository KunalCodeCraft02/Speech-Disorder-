import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { settings } from '../dsp/config';

/**
 * Tone/pitch prosody cue -- toast only, and must never vibrate the device
 * (Part 3): this hook has no dependency on lib/haptics.ts at all, so there
 * is no shared call site for a pitch condition to trigger the tachylalia
 * alert's vibration through.
 *
 * Fires only on a meaningful, sustained pitch deviation above the
 * patient's own calibrated baseline -- not on every small natural
 * fluctuation. Reuses the classifier's zPitch (already normalized by the
 * patient's personal pitch std, with a floor -- see classifier.ts), which
 * is both what makes the tolerance personalized and what lets this hook
 * stay a thin presentation-layer consumer instead of re-deriving pitch
 * math of its own (Part 22). zPitch is EMA-smoothed here, and the
 * deviation must hold continuously for `toneAlertSustainSec` (real
 * session time, not frame count) before it counts as "sustained" rather
 * than a temporary wobble.
 */
export function usePitchAlert(frame: MetricsFrame | null) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const smoothedZRef = useRef<number | null>(null);
  const sustainStartSecRef = useRef<number | null>(null);
  const lastFiredAtSecRef = useRef<number>(-Infinity);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setToastMessage(null);
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!frame || frame.classification === 'uncalibrated') {
      // No personal baseline yet (or session ended) -- nothing to compare
      // against, and stale smoothing/sustain state from a prior session
      // must not leak into the next one.
      smoothedZRef.current = null;
      sustainStartSecRef.current = null;
      return;
    }

    const alpha = settings.toneAlertSmoothingAlpha;
    smoothedZRef.current = smoothedZRef.current === null ? frame.zPitch : smoothedZRef.current + alpha * (frame.zPitch - smoothedZRef.current);
    const smoothedZ = smoothedZRef.current;

    const exceeds = smoothedZ > settings.toneAlertZThreshold;
    if (!exceeds) {
      sustainStartSecRef.current = null;
      return;
    }
    if (sustainStartSecRef.current === null) sustainStartSecRef.current = frame.elapsedSec;

    const sustainedSec = frame.elapsedSec - sustainStartSecRef.current;
    if (sustainedSec < settings.toneAlertSustainSec) return;
    if (frame.elapsedSec - lastFiredAtSecRef.current < settings.toneAlertCooldownSec) return;

    lastFiredAtSecRef.current = frame.elapsedSec;
    setToastMessage('Try lowering your tone');

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setToastMessage(null), settings.toneAlertToastVisibleSec * 1000);
  }, [frame]);

  useEffect(
    () => () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    },
    []
  );

  return { toastMessage, dismiss };
}
