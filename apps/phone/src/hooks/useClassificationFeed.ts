import { useEffect, useRef, useState } from 'react';
import { dataClient } from '../lib/dataClient';
import { tokenStore } from '../lib/api';
import { DASHBOARD_EVENTS } from '../lib/socket';
import type { Transport } from '../lib/transport';
import type { Classification, MetricsUpdateEvent } from '../types';

/**
 * A second, lightweight connection to the /dashboard namespace, used to
 * read back the live metrics stream for the session this device just
 * started. socketAuth's canViewUser (services/gateway/src/sockets/
 * handlers/dashboard.handler.js) allows a user to subscribe to their own
 * user room, so the patient's own phone is an authorized dashboard viewer
 * — no backend change needed.
 *
 * Widened from classification-only to the full frame (Part F: phone shows
 * the same primary/secondary parameter set as the dashboard, and the
 * pitch/tone alert (Part E.13) needs meanPitchHz/meanPitchTrendHz).
 */
export function useClassificationFeed(userId: string | undefined, sessionId: string | null) {
  const [classification, setClassification] = useState<Classification | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [latest, setLatest] = useState<MetricsUpdateEvent | null>(null);
  const transportRef = useRef<Transport | null>(null);

  useEffect(() => {
    if (!userId) return;
    const accessToken = tokenStore.getAccess();
    if (!accessToken) return;

    const transport = dataClient.createDashboardTransport(accessToken);
    transportRef.current = transport;

    const subscribeUser = () => transport.emit(DASHBOARD_EVENTS.subscribeUser, { userId });
    if (transport.connected) subscribeUser();
    transport.on('connect', subscribeUser);

    return () => {
      transport.off('connect', subscribeUser);
      transport.disconnect();
      transportRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    const transport = transportRef.current;
    if (!transport || !sessionId) {
      setClassification(null);
      setConfidence(null);
      setLatest(null);
      return;
    }

    const handleMetrics = (payload: unknown) => {
      const frame = payload as MetricsUpdateEvent;
      if (frame.sessionId !== sessionId) return;
      setClassification(frame.classification);
      setConfidence(frame.confidence);
      setLatest(frame);
    };

    transport.on(DASHBOARD_EVENTS.metricsUpdate, handleMetrics);
    transport.emit(DASHBOARD_EVENTS.subscribeSession, { sessionId });

    return () => {
      transport.emit(DASHBOARD_EVENTS.unsubscribeSession, { sessionId });
      transport.off(DASHBOARD_EVENTS.metricsUpdate, handleMetrics);
      setClassification(null);
      setConfidence(null);
      setLatest(null);
    };
  }, [sessionId]);

  return { classification, confidence, latest };
}
