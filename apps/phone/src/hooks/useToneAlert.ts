import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { settings } from '../dsp/config';
import * as C from '../dsp/constants';
import { toneAlertHaptic } from '../lib/haptics';

/**
 * Tone alert -- driven by loudness only (item 5: pitch no longer feeds
 * this at all; zPitch/meanPitchHz stay displayed as a metric on their own
 * param card, nothing more). Fires "Lower your tone" plus a distinct
 * two-pulse haptic (see haptics.ts's toneAlertHaptic, clearly different by
 * feel from the continuous tachylalia buzz) once loudnessDb has stayed
 * above LOUDNESS_ALERT_DBFS_THRESHOLD for toneAlertSustainSec, strictly
 * gated to actual VAD-confirmed speech (item 3/4):
 *
 *   if (!frame.livePhonationActive || frame.loudnessDb === null) -> never
 *   evaluate or fire this window at all. loudnessDb is held at its last
 *   valid reading during silence (sessionPipeline.ts's applyLiveVadGate),
 *   and this hook must not treat that held reading as "still sustained"
 *   once the patient has actually stopped talking, nor fire on a
 *   currently-unavailable (null) reading.
 *
 * Its own independent cooldown (toneAlertCooldownSec) means this can fire
 * in the same session as the main tachylalia vibration without the two
 * cooldowns interacting.
 */
export function useToneAlert(frame: MetricsFrame | null) {
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
      // Item 3/4: no VAD-confirmed speech this window, or no valid/current
      // loudness reading -- never evaluate the threshold, and pause (don't
      // just ignore) the sustain timer so a silence gap can't be silently
      // bridged as "still sustained" once speech resumes.
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
    if (sustainedSec < settings.toneAlertSustainSec) return;
    if (frame.elapsedSec - lastFiredAtSecRef.current < settings.toneAlertCooldownSec) return;

    lastFiredAtSecRef.current = frame.elapsedSec;
    setToastMessage('Lower your tone');
    void toneAlertHaptic();

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
