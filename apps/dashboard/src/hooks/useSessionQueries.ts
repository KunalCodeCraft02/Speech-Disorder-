import { useQuery } from '@tanstack/react-query';
import { dataClient } from '../lib/dataClient';
import type { SessionStatus } from '../types';

export function useActiveSession(userId: string | undefined) {
  return useQuery({
    queryKey: ['sessions', 'active', userId],
    queryFn: () => dataClient.listSessions({ status: 'active', limit: 1 }),
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    select: (data) => data.items[0] ?? null,
  });
}

export function useSessionsList(params: { status?: SessionStatus; page?: number; limit?: number }) {
  return useQuery({
    queryKey: ['sessions', 'list', params],
    queryFn: () => dataClient.listSessions(params),
  });
}

export function useSessionMetricsHistory(sessionId: string | undefined, limit = 150) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'metrics', limit],
    queryFn: () => dataClient.getSessionMetrics(sessionId as string, limit),
    enabled: Boolean(sessionId),
    select: (data) => data.items,
  });
}

export function useCalibration(userId: string | undefined) {
  return useQuery({
    queryKey: ['calibration', userId],
    queryFn: () => dataClient.getCalibration(userId as string),
    enabled: Boolean(userId),
    // Without this, a calibration completed on the phone after the
    // dashboard loaded never appears until a manual reload -- there's no
    // push notification for it, so poll the same way useActiveSession does.
    refetchInterval: 15_000,
  });
}
