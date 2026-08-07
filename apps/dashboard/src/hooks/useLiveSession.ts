import { useCallback, useEffect, useRef, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { tokenStore } from '../lib/api';
import { DASHBOARD_EVENTS } from '../lib/socket';
import type { DashboardTransport } from '../lib/transport';
import type { DisorderMode, FeedbackLoggedEvent, MetricsFrame, SessionEndedEvent, SessionStartedEvent, SocketErrorEvent } from '../types';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';
export type ConnectionLogLevel = 'info' | 'success' | 'warn' | 'error';

const MAX_HISTORY = 180;
const MAX_FEEDBACK_LOG = 30;
const MAX_LOG = 50;

export interface ConnectionLogEntry {
  id: string;
  ts: number;
  message: string;
  level: ConnectionLogLevel;
}

export interface LiveSessionState {
  connectionState: ConnectionState;
  latest: MetricsFrame | null;
  history: MetricsFrame[];
  feedbackEvents: FeedbackLoggedEvent[];
  sessionEnded: SessionEndedEvent | null;
  errorMessage: string | null;
  connectionLog: ConnectionLogEntry[];
  disorderMode: DisorderMode | null;
  demoMode: boolean;
  reset: () => void;
}

// crypto.randomUUID() (not an incrementing counter) so ids stay unique even
// across a Vite HMR reload of this module during development -- a plain
// module-level counter resets to 0 on reload while React's existing log
// entries (with their old ids) survive, producing duplicate-key warnings.
function nextLogId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}-${Math.random()}`;
}

/**
 * Owns one Socket.IO connection to the gateway's /dashboard namespace
 * (or the demo simulator standing in for it) for the lifetime of the
 * authenticated user, subscribing/unsubscribing to `sessionId`'s room as
 * it changes so charts only ever show data for the session on screen.
 */
export function useLiveSession(userId: string | undefined, sessionId: string | null | undefined): LiveSessionState {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [latest, setLatest] = useState<MetricsFrame | null>(null);
  const [history, setHistory] = useState<MetricsFrame[]>([]);
  const [feedbackEvents, setFeedbackEvents] = useState<FeedbackLoggedEvent[]>([]);
  const [sessionEnded, setSessionEnded] = useState<SessionEndedEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionLog, setConnectionLog] = useState<ConnectionLogEntry[]>([]);
  const [disorderMode, setDisorderMode] = useState<DisorderMode | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const transportRef = useRef<DashboardTransport | null>(null);

  const pushLog = useCallback((message: string, level: ConnectionLogLevel = 'info') => {
    setConnectionLog((prev) => {
      const next = [{ id: nextLogId(), ts: Date.now(), message, level }, ...prev];
      return next.length > MAX_LOG ? next.slice(0, MAX_LOG) : next;
    });
  }, []);

  // Manual "clear the board" action for the dashboard toolbar — wipes the
  // live gauges/charts/feedback list back to empty without touching the
  // connection log (that's the audit trail, not a "value").
  const reset = useCallback(() => {
    setLatest(null);
    setHistory([]);
    setFeedbackEvents([]);
    setSessionEnded(null);
    pushLog('Live view reset manually', 'info');
  }, [pushLog]);

  // One connection per authenticated user, torn down on unmount/logout.
  useEffect(() => {
    if (!userId) return;
    const accessToken = tokenStore.getAccess();
    if (!accessToken) return;

    const transport = dataClient.createTransport(accessToken);
    transportRef.current = transport;
    setConnectionState('connecting');
    pushLog('Connecting to gateway…');

    const handleConnect = () => {
      setConnectionState('connected');
      setErrorMessage(null);
      pushLog('Connected to gateway', 'success');
      transport.emit(DASHBOARD_EVENTS.subscribeUser, { userId });
      pushLog(`Subscribed to updates for user ${userId}`);
    };
    const handleDisconnect = () => {
      setConnectionState('disconnected');
      pushLog('Disconnected from gateway', 'warn');
    };
    const handleError = (err: unknown) => {
      setConnectionState('error');
      const message = err instanceof Error ? err.message : 'Connection error';
      setErrorMessage(message);
      pushLog(`Connection error: ${message}`, 'error');
    };
    const handleSocketError = (payload: unknown) => {
      const e = payload as SocketErrorEvent;
      setErrorMessage(e.message);
      pushLog(`Socket error: ${e.message}`, 'error');
    };

    transport.on('connect', handleConnect);
    transport.on('disconnect', handleDisconnect);
    transport.on('connect_error', handleError);
    transport.on(DASHBOARD_EVENTS.sessionError, handleSocketError);

    // Demo transport is connected synchronously and never fires a
    // 'connect' event (there's no handshake) — kick it off directly.
    if (transport.connected) handleConnect();

    return () => {
      transport.off('connect', handleConnect);
      transport.off('disconnect', handleDisconnect);
      transport.off('connect_error', handleError);
      transport.off(DASHBOARD_EVENTS.sessionError, handleSocketError);
      transport.disconnect();
      transportRef.current = null;
    };
  }, [userId, pushLog]);

  // Subscribe to the session currently on screen; swap cleanly when it changes.
  useEffect(() => {
    const transport = transportRef.current;
    if (!transport || !sessionId) return;

    setHistory([]);
    setLatest(null);
    setFeedbackEvents([]);
    setSessionEnded(null);
    let receivedFirstMetrics = false;

    const handleMetrics = (payload: unknown) => {
      const frame = payload as MetricsFrame;
      if (frame.sessionId !== sessionId) return;
      if (!receivedFirstMetrics) {
        receivedFirstMetrics = true;
        pushLog('Live metrics arriving from phone — audio link confirmed', 'success');
      }
      setLatest(frame);
      setHistory((prev) => {
        const next = [...prev, frame];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
    };

    const handleFeedback = (payload: unknown) => {
      const event = payload as FeedbackLoggedEvent;
      if (event.sessionId !== sessionId) return;
      setFeedbackEvents((prev) => [event, ...prev].slice(0, MAX_FEEDBACK_LOG));
      pushLog(`Vibration feedback sent to phone (${event.reason})`, 'warn');
    };

    const handleEnded = (payload: unknown) => {
      const event = payload as SessionEndedEvent;
      if (event.sessionId !== sessionId) return;
      setSessionEnded(event);
      // Phone stopped recording (or disconnected mid-session) — the live
      // feed is gone, so clear the gauges/charts/feedback list rather than
      // leaving the last frame frozen on screen.
      setLatest(null);
      setHistory([]);
      setFeedbackEvents([]);
      pushLog('Phone disconnected — session ended, live view reset', 'warn');
    };

    const handleStarted = (payload: unknown) => {
      const event = payload as SessionStartedEvent;
      setDisorderMode(event.disorderMode ?? null);
      setDemoMode(Boolean(event.demoMode));
      pushLog(`Phone started session ${event.sessionId}`, 'success');
    };

    transport.on(DASHBOARD_EVENTS.metricsUpdate, handleMetrics);
    transport.on(DASHBOARD_EVENTS.feedbackLogged, handleFeedback);
    transport.on(DASHBOARD_EVENTS.sessionEnded, handleEnded);
    transport.on(DASHBOARD_EVENTS.sessionStarted, handleStarted);
    transport.emit(DASHBOARD_EVENTS.subscribeSession, { sessionId });
    pushLog(`Subscribed to session ${sessionId}`);

    return () => {
      transport.emit(DASHBOARD_EVENTS.unsubscribeSession, { sessionId });
      transport.off(DASHBOARD_EVENTS.metricsUpdate, handleMetrics);
      transport.off(DASHBOARD_EVENTS.feedbackLogged, handleFeedback);
      transport.off(DASHBOARD_EVENTS.sessionEnded, handleEnded);
      transport.off(DASHBOARD_EVENTS.sessionStarted, handleStarted);
    };
  }, [sessionId, pushLog]);

  return {
    connectionState,
    latest,
    history,
    feedbackEvents,
    sessionEnded,
    errorMessage,
    connectionLog,
    disorderMode,
    demoMode,
    reset,
  };
}
