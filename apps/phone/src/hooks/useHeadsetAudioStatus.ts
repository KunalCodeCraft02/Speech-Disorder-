// Part J: headphones/earbuds gate. Native-only -- see lib/headsetAudio.ts's
// doc comment for why there is no meaningful web check. On web (dev/PWA),
// the gate is a no-op (always "connected") so local development and any
// non-Android install keep working; the shipped product is the Android APK
// (see .github/workflows/build-apk.yml), where this actually enforces the
// requirement.

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { HeadsetAudio, type HeadsetAudioStatus } from '../lib/headsetAudio';

// Belt-and-suspenders alongside the native AudioDeviceCallback push events
// (HeadsetAudioPlugin.java) -- a periodic poll means a missed/late callback
// (or a status change while the WebView itself was backgrounded) still
// self-corrects within a few seconds instead of leaving the gate stuck
// showing stale state.
const POLL_INTERVAL_MS = 4000;

export interface HeadsetAudioGateState {
  /** True on web/non-native, where this gate does not apply. */
  connected: boolean;
  /** True until the first native status check resolves -- avoids flashing the "connect your headphones" prompt for a moment on launch before we actually know. */
  checking: boolean;
  recheck: () => void;
}

export function useHeadsetAudioStatus(): HeadsetAudioGateState {
  const native = Capacitor.isNativePlatform();
  const [connected, setConnected] = useState(!native);
  const [checking, setChecking] = useState(native);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyStatus = (status: HeadsetAudioStatus) => {
    if (!mountedRef.current) return;
    setConnected(status.connected);
    setChecking(false);
  };

  const recheck = () => {
    if (!native) return;
    void HeadsetAudio.getStatus().then(applyStatus);
  };

  useEffect(() => {
    if (!native) return;

    let cancelled = false;
    void HeadsetAudio.getStatus().then((status) => {
      if (!cancelled) applyStatus(status);
    });

    const listenerPromise = HeadsetAudio.addListener('change', applyStatus);
    const interval = setInterval(recheck, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      void listenerPromise.then((handle) => handle.remove());
    };
  }, [native]);

  return { connected, checking, recheck };
}
