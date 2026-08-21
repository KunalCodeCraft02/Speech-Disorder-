// Native haptics wrapper for the tachylalia (speech-rate) alert only.
// navigator.vibrate() is unreliable inside a Capacitor WebView on real
// devices -- Capacitor's Haptics plugin talks to the platform's native
// haptic engine directly and is the reliable path. Falls back to
// navigator.vibrate() on the web (Capacitor.isNativePlatform() is false
// there), and finally to a synthesized beep + visual pulse if neither is
// available (e.g. iOS Safari with vibrate unsupported).
//
// Pitch/tone feedback must never vibrate the device (toast-only, see
// usePitchAlert.ts) -- this module intentionally exposes no tone/pitch
// entry point, so there is nothing here for that alert to accidentally
// call into.

import { Capacitor } from '@capacitor/core';
import { Haptics, NotificationType } from '@capacitor/haptics';

// The alert must be clearly felt, not a quick tap -- a continuous buzz
// comfortably over the 2s floor.
const MAIN_ALERT_DURATION_MS = 2200;

const VIBRATE_SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let inFlight = false;

/**
 * Tachylalia alert: one continuous ~2.2s vibration. The classifier's
 * triggerFeedback is strictly edge-triggered (fires once on the
 * NORMAL->TACHYLALIA transition, not again until a return to normal and a
 * fresh transition -- see classifier.ts Step 4) so this can't be re-fired
 * while the condition stays continuously abnormal; `inFlight` is a
 * defensive second guard so even a caller bug can't stack two overlapping
 * vibrate() calls into one another.
 *
 * Returns false if neither native Haptics nor navigator.vibrate fired, so
 * the caller can fall back to the beep+visual pulse.
 */
export async function mainAlertHaptic(): Promise<boolean> {
  if (inFlight) return true;
  inFlight = true;
  try {
    if (Capacitor.isNativePlatform()) {
      await Haptics.vibrate({ duration: MAIN_ALERT_DURATION_MS });
      return true;
    }
    if (VIBRATE_SUPPORTED) {
      navigator.vibrate(MAIN_ALERT_DURATION_MS);
      return true;
    }
    return false;
  } finally {
    setTimeout(() => {
      inFlight = false;
    }, MAIN_ALERT_DURATION_MS);
  }
}

/**
 * Loudness alert (Part G): a distinct, short native "notification" haptic
 * (not the continuous tachylalia buzz) -- deliberately a different
 * Capacitor Haptics call (`notification` vs. `vibrate`) so the two alerts
 * are physically distinguishable on-device, matching their separate
 * cooldowns (see useLoudnessAlert.ts). No `inFlight` guard here: unlike the
 * main alert this is a brief, non-overlapping native effect, and the
 * hook's own loudnessAlertCooldownSec already prevents rapid re-firing.
 */
export async function loudnessAlertHaptic(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    await Haptics.notification({ type: NotificationType.Warning });
    return true;
  }
  if (VIBRATE_SUPPORTED) {
    navigator.vibrate(200);
    return true;
  }
  return false;
}
