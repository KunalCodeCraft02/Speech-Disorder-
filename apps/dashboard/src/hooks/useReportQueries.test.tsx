import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDownloadReport, useGenerateSessionReport, useSessionReport } from './useReportQueries';
import { dataClient } from '../lib/dataClient';
import type { Report } from '../types';

vi.mock('../lib/dataClient', () => ({
  dataClient: {
    getReportForSession: vi.fn(),
    generateSessionReport: vi.fn(),
    downloadReport: vi.fn(),
  },
}));

const REPORT: Report = {
  _id: 'r1',
  userId: 'u1',
  authorId: 'u1',
  title: 'Speech Session Report',
  type: 'session',
  status: 'finalized',
  sessionIds: ['s1'],
  analysisResultIds: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useSessionReport', () => {
  beforeEach(() => vi.clearAllMocks());

  test('fetches the report for a given session id', async () => {
    vi.mocked(dataClient.getReportForSession).mockResolvedValue(REPORT);
    const { result } = renderHook(() => useSessionReport('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(REPORT);
    expect(dataClient.getReportForSession).toHaveBeenCalledWith('s1');
  });

  test('does not fetch when disabled', () => {
    renderHook(() => useSessionReport('s1', false), { wrapper });
    expect(dataClient.getReportForSession).not.toHaveBeenCalled();
  });

  test('does not fetch when sessionId is undefined', () => {
    renderHook(() => useSessionReport(undefined), { wrapper });
    expect(dataClient.getReportForSession).not.toHaveBeenCalled();
  });
});

describe('useGenerateSessionReport', () => {
  beforeEach(() => vi.clearAllMocks());

  test('generates a report and seeds the session-report query cache with it', async () => {
    vi.mocked(dataClient.generateSessionReport).mockResolvedValue(REPORT);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const localWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useGenerateSessionReport('s1'), { wrapper: localWrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(dataClient.generateSessionReport).toHaveBeenCalledWith('s1');
    expect(client.getQueryData(['reports', 'session', 's1'])).toEqual(REPORT);
  });
});

describe('useDownloadReport', () => {
  beforeEach(() => vi.clearAllMocks());

  test('calls dataClient.downloadReport with the given report', async () => {
    vi.mocked(dataClient.downloadReport).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDownloadReport(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(REPORT);
    });

    expect(dataClient.downloadReport).toHaveBeenCalledWith(REPORT);
  });
});
