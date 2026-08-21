import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { settings } from '../dsp/config';
import * as C from '../dsp/constants';
import { toneAlertHaptic } from '../lib/haptics';

/**
 * Tone alert -- driven by loudness only (item 5: pitch no longer feeds
 * this at all; zPitch/meanPitchHz stay displayed as a metric on their own
 * param card, nothing more). Fires "Lower your tone" plus a distinct
 * single short haptic pulse (see haptics.ts's toneAlertHaptic, clearly
 * different by feel from the continuous tachylalia buzz) once loudnessDb has stayed
 * above LOUDNESS_THRESHOLD_DBFS for toneAlertSustainSec, strictly gated to
 * actual VAD-confirmed speech:
 *
 *   if (!frame.livePhonationActive || frame.loudnessDb === null) -> never
 *   evaluate or fire this window at all. loudnessDb is held at its last
 *   valid reading during silence (sessionPipeline.ts's applyLiveVadGate),
 *   and this hook must not treat that held reading as "still sustained"
 *   once the patient has actually stopped talking, nor fire on a
 *   currently-unavailable (null) reading.
 *
 * Item 4 debounce (mirrors classifier.ts's Step 4 for the tachylalia
 * alert): natural speech loudness fluctuates syllable-to-syllable, so a
 * genuinely loud stretch will still have some individual windows dip
 * momentarily below threshold. A single dip must not throw away the
 * in-progress sustain accumulation (`sustainStartSecRef`) or force a
 * fresh 3-second wait -- only once the reading has stayed genuinely below
 * threshold for longer than FEEDBACK_EPISODE_GAP_TOLERANCE_SEC does the
 * episode actually end. The repeat-fire cooldown (toneAlertCooldownSec)
 * still throttles re-fires during one long sustained episode exactly as
 * before -- this only fixes premature resets from momentary dips.
 *
 * Its own independent cooldown (toneAlertCooldownSec) means this can fire
 * in the same session as the main tachylalia vibration without the two
 * cooldowns interacting.
 */
export function useToneAlert(frame: MetricsFrame | null) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const sustainStartSecRef = useRef<number | null>(null);
  const lastAboveThresholdSecRef = useRef<number | null>(null);
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
      lastAboveThresholdSecRef.current = null;
      return;
    }

    if (!frame.livePhonationActive || frame.loudnessDb === null) {
      // No VAD-confirmed speech this window, or no valid/current loudness
      // reading -- never evaluate the threshold, and end the episode
      // outright (silence is never "a brief dip," it's the patient not
      // talking).
      sustainStartSecRef.current = null;
      lastAboveThresholdSecRef.current = null;
      return;
    }

    const exceeds = frame.loudnessDb > C.LOUDNESS_THRESHOLD_DBFS;
    if (exceeds) {
      lastAboveThresholdSecRef.current = frame.elapsedSec;
      if (sustainStartSecRef.current === null) sustainStartSecRef.current = frame.elapsedSec;
    } else {
      const withinEpisodeGap =
        lastAboveThresholdSecRef.current !== null && frame.elapsedSec - lastAboveThresholdSecRef.current < C.FEEDBACK_EPISODE_GAP_TOLERANCE_SEC;
      if (!withinEpisodeGap) {
        sustainStartSecRef.current = null;
        lastAboveThresholdSecRef.current = null;
      }
      return;
    }

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
