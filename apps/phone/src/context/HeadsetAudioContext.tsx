import { createContext, useContext, type ReactNode } from 'react';
import { useHeadsetAudioStatus, type HeadsetAudioGateState } from '../hooks/useHeadsetAudioStatus';

const HeadsetAudioContext = createContext<HeadsetAudioGateState | null>(null);

/**
 * Single shared "is a headset (Bluetooth/wired/USB) connected" subscription
 * (Part J), mounted once at the App root above both the gate screen (which
 * reads `connected` to decide whether to block the UI) and SessionProvider
 * (whose useLiveSession watches the same value to force-stop an
 * in-progress session the instant the headset disconnects). Mounting one
 * poll/listener here instead of in each consumer avoids duplicate native
 * calls.
 */
export function HeadsetAudioProvider({ children }: { children: ReactNode }) {
  const status = useHeadsetAudioStatus();
  return <HeadsetAudioContext.Provider value={status}>{children}</HeadsetAudioContext.Provider>;
}

export function useHeadsetAudioContext(): HeadsetAudioGateState {
  const ctx = useContext(HeadsetAudioContext);
  if (!ctx) throw new Error('useHeadsetAudioContext must be used within a HeadsetAudioProvider');
  return ctx;
}
