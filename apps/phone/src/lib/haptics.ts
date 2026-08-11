// Native haptics wrapper (Part A). navigator.vibrate() is unreliable inside
// a Capacitor WebView on real devices -- Capacitor's Haptics plugin talks to
// the platform's native haptic engine directly and is the reliable path.
// Falls back to navigator.vibrate() on the web (Capacitor.isNativePlatform()
// is false there), and finally to a synthesized beep + visual pulse if
// neither is available (e.g. iOS Safari with vibrate unsupported).
//
// The two alerts must always feel distinct and must never share a call site,
// so a caller can never accidentally fire one pattern through the other's
// cooldown:
//   - mainAlertHaptic(): tachylalia trigger — two Heavy impacts, 100ms apart.
//   - toneAlertHaptic(): "lower your tone" cue — one Warning notification.

import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const MAIN_ALERT_VIBRATION_PATTERN = [80, 60, 80, 60, 80];
const TONE_ALERT_VIBRATION_PATTERN = [50];

const VIBRATE_SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Main tachylalia alert: two Heavy impacts 100ms apart. Returns false if neither native Haptics nor navigator.vibrate fired, so the caller can fall back to the beep+visual pulse. */
export async function mainAlertHaptic(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    await Haptics.impact({ style: ImpactStyle.Heavy });
    await sleep(100);
    await Haptics.impact({ style: ImpactStyle.Heavy });
    return true;
  }
  if (VIBRATE_SUPPORTED) {
    navigator.vibrate(MAIN_ALERT_VIBRATION_PATTERN);
    return true;
  }
  return false;
}

/** Tone (pitch-rising) alert: a single Warning notification -- its own pattern, never mainAlertHaptic's. */
export async function toneAlertHaptic(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Haptics.notification({ type: NotificationType.Warning });
    return;
  }
  if (VIBRATE_SUPPORTED) {
    navigator.vibrate(TONE_ALERT_VIBRATION_PATTERN);
  }
}
