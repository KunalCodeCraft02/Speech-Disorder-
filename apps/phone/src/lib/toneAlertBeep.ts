// TS wrapper for the native ToneAlertBeepPlugin (see
// android/app/src/main/java/com/speechbiofeedback/app/ToneAlertBeepPlugin.java).
// Plays the tone (loudness) alert's short bundled beep -- useToneAlert.ts calls this
// alongside toneAlertHaptic() every time "Lower your tone" fires, same trigger and
// cooldown as the vibration. Native-only: the plugin loads its sound from a bundled APK
// resource and checks the device's ringer mode before playing, neither of which has a web
// equivalent, so on web (Capacitor.isNativePlatform() false, e.g. local dev) this falls
// back to the existing synthesized Web Audio beep (lib/beep.ts) instead -- same role, no
// silent-mode check there since browsers don't expose one.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { playBeep } from './beep';

interface ToneAlertBeepPlugin {
  play(): Promise<void>;
}

const ToneAlertBeepNative = registerPlugin<ToneAlertBeepPlugin>('ToneAlertBeep');

export async function playToneAlertBeep(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await ToneAlertBeepNative.play();
    return;
  }
  playBeep(180, 880, 0.6);
}
