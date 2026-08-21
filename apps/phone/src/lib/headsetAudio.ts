// TS wrapper for the native HeadsetAudioPlugin (see
// android/app/src/main/java/com/speechbiofeedback/app/HeadsetAudioPlugin.java),
// which reports whether a microphone-capable headset -- Bluetooth earbuds,
// a wired headset, or a USB headset -- is currently connected. Part J's
// Start/session gate.
//
// Only meaningful on native Android: the Web Bluetooth API has no concept
// of "which device is the current audio input route," and there's no web
// equivalent for wired/USB headset detection either. Callers must check
// Capacitor.isNativePlatform() before touching this module (see
// hooks/useHeadsetAudioStatus.ts).

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface HeadsetAudioStatus {
  connected: boolean;
}

export interface HeadsetAudioPlugin {
  getStatus(): Promise<HeadsetAudioStatus>;
  addListener(eventName: 'change', listenerFunc: (status: HeadsetAudioStatus) => void): Promise<PluginListenerHandle>;
}

export const HeadsetAudio = registerPlugin<HeadsetAudioPlugin>('HeadsetAudio');
