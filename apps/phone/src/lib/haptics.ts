// Native haptics wrapper for the app's two device alerts: the tachylalia
// (speech-rate) alert and the tone (loudness) alert -- item 10 requires
// these be distinguishable by feel alone, so each gets its own, physically
// different pattern (see mainAlertHaptic vs. toneAlertHaptic below).
// navigator.vibrate() is unreliable inside a Capacitor WebView on real
// devices -- Capacitor's Haptics plugin talks to the platform's native
// haptic engine directly and is the reliable path. Falls back to
// navigator.vibrate() on the web (Capacitor.isNativePlatform() is false
// there), and finally to a synthesized beep + visual pulse if neither is
// available (e.g. iOS Safari with vibrate unsupported).

import { Capacitor } from '@capacitor/core';
import { Haptics } from '@capacitor/haptics';

// The alert must be clearly felt, not a quick tap -- a continuous buzz
// comfortably over the 2s floor.
const MAIN_ALERT_DURATION_MS = 2200;

const VIBRATE_SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let inFlight = false;

/**
 * Tachylalia alert: one continuous ~2.2s vibration -- kept as-is (item 10
 * says keep this pattern unchanged). The classifier fires triggerFeedback
 * immediately on the first abnormal window, then re-fires every
 * FEEDBACK_REFRACTORY_SEC while it stays abnormal (see classifier.ts Step
 * 4); `inFlight` guards against two overlapping vibrate() calls stacking
 * if a re-fire lands before the previous ~2.2s pulse has finished.
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

// Item 10/6: one short, light pulse -- clearly shorter and gentler than the
// tachylalia alert's ~2.2s continuous buzz above, so the two are
// distinguishable by feel alone without needing to count pulses. Was
// briefly a two-pulse pattern; changed to a single pulse per explicit
// spec ("a single brief, light pulse", not a double-tap) -- duration well
// under half of even one of the old pulses-plus-gap, and nowhere near the
// main alert's duration, so there's no ambiguity between the two even for
// a distracted patient.
const TONE_ALERT_PULSE_MS = 80;

/**
 * Tone (loudness) alert: one short, light vibration pulse -- distinct from
 * the tachylalia alert's one long continuous buzz (mainAlertHaptic above)
 * by both duration and feel. No `inFlight` guard here: unlike the main
 * alert this is a single brief, non-overlapping effect, and the hook's own
 * toneAlertCooldownSec already prevents rapid re-firing.
 */
export async function toneAlertHaptic(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    await Haptics.vibrate({ duration: TONE_ALERT_PULSE_MS });
    return true;
  }
  if (VIBRATE_SUPPORTED) {
    navigator.vibrate(TONE_ALERT_PULSE_MS);
    return true;
  }
  return false;
}
