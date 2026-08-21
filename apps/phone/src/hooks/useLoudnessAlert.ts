import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { settings } from '../dsp/config';
import * as C from '../dsp/constants';
import { loudnessAlertHaptic } from '../lib/haptics';

/**
 * Loudness alert (Part G): fixed absolute threshold (not personal-baseline
 * relative, unlike the tone alert) -- fires "Lower your tone" plus a short
 * native notification haptic once loudnessDb has stayed above
 * LOUDNESS_ALERT_DBFS_THRESHOLD for loudnessAlertSustainSec, gated to
 * actual VAD-confirmed speech per Part A (see frame.livePhonationActive --
 * loudnessDb is held at its last valid reading during silence, and this
 * hook must not treat that held reading as "still sustained" once the
 * patient has actually stopped talking).
 *
 * Its own independent cooldown (loudnessAlertCooldownSec) means this can
 * fire in the same session as the main tachylalia vibration or the pitch
 * toast without their cooldowns interacting.
 */
export function useLoudnessAlert(frame: MetricsFrame | null) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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
      sustainStartSecRef.current = null;
      return;
    }

    if (!frame.livePhonationActive || frame.loudnessDb === null) {
      // Part A: no VAD-confirmed speech this window (or no loudness
      // reading at all yet) -- suppress and pause the sustain timer, same
      // as usePitchAlert.ts.
      sustainStartSecRef.current = null;
      return;
    }

    const exceeds = frame.loudnessDb > C.LOUDNESS_ALERT_DBFS_THRESHOLD;
    if (!exceeds) {
      sustainStartSecRef.current = null;
      return;
    }
    if (sustainStartSecRef.current === null) sustainStartSecRef.current = frame.elapsedSec;

    const sustainedSec = frame.elapsedSec - sustainStartSecRef.current;
    if (sustainedSec < settings.loudnessAlertSustainSec) return;
    if (frame.elapsedSec - lastFiredAtSecRef.current < settings.loudnessAlertCooldownSec) return;

    lastFiredAtSecRef.current = frame.elapsedSec;
    setToastMessage('Lower your tone');
    void loudnessAlertHaptic();

    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setToastMessage(null), settings.loudnessAlertToastVisibleSec * 1000);
  }, [frame]);

  useEffect(
    () => () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    },
    []
  );

  return { toastMessage, dismiss };
}
