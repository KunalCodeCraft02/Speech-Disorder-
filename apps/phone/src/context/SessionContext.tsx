import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveSession } from '../hooks/useLiveSession';
import type { MetricsFrame } from '../dsp/sessionPipeline';

const MAX_HISTORY = 240;

interface SessionContextValue extends ReturnType<typeof useLiveSession> {
  /** Rolling buffer of this session's metrics frames, oldest first, capped at MAX_HISTORY -- feeds the Analytics tab's charts. Cleared when a new recording starts. */
  history: MetricsFrame[];
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Owns the single useLiveSession() subscription (mic capture -> DSP
 * pipeline -> classification) at the App root, so navigating between the
 * Main screen and the Analytics tab does not unmount it, stop the
 * recording, or open a second capture stream. Both screens read the same
 * `latest` frame and this shared `history` buffer via useSessionContext().
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const session = useLiveSession();
  const [history, setHistory] = useState<MetricsFrame[]>([]);
  const prevStateRef = useRef(session.recordingState);

  useEffect(() => {
    if (session.recordingState === 'recording' && prevStateRef.current !== 'recording') {
      setHistory([]);
    }
    prevStateRef.current = session.recordingState;
  }, [session.recordingState]);

  useEffect(() => {
    if (!session.latest) return;
    const frame = session.latest;
    setHistory((prev) => {
      const next = [...prev, frame];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, [session.latest]);

  return <SessionContext.Provider value={{ ...session, history }}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within a SessionProvider');
  return ctx;
}
