import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataClient } from '../lib/dataClient';
import type { Report } from '../types';

export function useSessionReport(sessionId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['reports', 'session', sessionId],
    queryFn: () => dataClient.getReportForSession(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
  });
}

export function useGenerateSessionReport(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dataClient.generateSessionReport(sessionId),
    onSuccess: (report: Report) => {
      queryClient.setQueryData(['reports', 'session', sessionId], report);
    },
  });
}

export function useDownloadReport() {
  return useMutation({
    mutationFn: (report: Report) => dataClient.downloadReport(report),
  });
}
