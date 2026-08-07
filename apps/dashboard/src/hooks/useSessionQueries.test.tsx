import { describe, expect, test, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useActiveSession,
  useCalibration,
  useSessionMetricsHistory,
  useSessionsList,
} from './useSessionQueries';
import { dataClient } from '../lib/dataClient';
import type { Session } from '../types';

vi.mock('../lib/dataClient', () => ({
  dataClient: {
    listSessions: vi.fn(),
    getSessionMetrics: vi.fn(),
    getCalibration: vi.fn(),
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ACTIVE_SESSION: Session = {
  _id: 's1',
  userId: 'u1',
  status: 'active',
  startedAt: '2026-01-01T00:00:00.000Z',
  summary: {
    durationSec: 0,
    avgArticulationRateSPS: null,
    avgSpeechRateWPM: null,
    avgPauseRatio: null,
    tachylaliaEvents: 0,
    bradylaliaEvents: 0,
    normalRatio: null,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useActiveSession', () => {
  beforeEach(() => vi.clearAllMocks());

  test('selects the first active session from the list', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({ items: [ACTIVE_SESSION], total: 1, page: 1, limit: 1, pages: 1 });
    const { result } = renderHook(() => useActiveSession('u1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(ACTIVE_SESSION));
    expect(dataClient.listSessions).toHaveBeenCalledWith({ status: 'active', limit: 1 });
  });

  test('resolves to null when there is no active session', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({ items: [], total: 0, page: 1, limit: 1, pages: 1 });
    const { result } = renderHook(() => useActiveSession('u1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  test('does not query when userId is undefined', () => {
    renderHook(() => useActiveSession(undefined), { wrapper });
    expect(dataClient.listSessions).not.toHaveBeenCalled();
  });
});

describe('useSessionsList', () => {
  beforeEach(() => vi.clearAllMocks());

  test('passes params through to dataClient.listSessions', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({ items: [], total: 0, page: 2, limit: 8, pages: 3 });
    const { result } = renderHook(() => useSessionsList({ page: 2, limit: 8 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(dataClient.listSessions).toHaveBeenCalledWith({ page: 2, limit: 8 });
    expect(result.current.data?.pages).toBe(3);
  });
});

describe('useSessionMetricsHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  test('selects just the items array from the paginated response', async () => {
    const metric = {
      _id: 'm1',
      sessionId: 's1',
      timestamp: '2026-01-01T00:00:00.000Z',
      elapsedSec: 1,
      articulationRateSPS: 4.2,
      speechRateWPM: 500,
      pauseRatio: 0.2,
      pauseFrequencyPerMin: null,
      speechToPauseRatio: null,
      meanPitchHz: null,
      pitchVariabilityHz: null,
      loudnessDb: null,
      voiceActivityPercent: null,
      speechConsistency: null,
      compositeScore: null,
      classification: 'normal' as const,
      confidence: null,
      zRate: null,
      zPause: null,
      zSyll: null,
      compositeZ: null,
      sampleSufficient: null,
      wordsPerLast30Sec: null,
      totalSyllablesSession: null,
      totalWordsSession: null,
      rateTrend: null,
      timeInAbnormalStateSec: null,
      recoveryTimeSec: null,
      loudnessVariabilityDb: null,
      meanPitchTrendHz: null,
    };
    vi.mocked(dataClient.getSessionMetrics).mockResolvedValue({ items: [metric], total: 1, page: 1, limit: 150, pages: 1 });

    const { result } = renderHook(() => useSessionMetricsHistory('s1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([metric]));
    expect(dataClient.getSessionMetrics).toHaveBeenCalledWith('s1', 150);
  });

  test('does not query when sessionId is undefined', () => {
    renderHook(() => useSessionMetricsHistory(undefined), { wrapper });
    expect(dataClient.getSessionMetrics).not.toHaveBeenCalled();
  });
});

describe('useCalibration', () => {
  beforeEach(() => vi.clearAllMocks());

  test('fetches calibration for the given userId', async () => {
    const calibration = {
      userId: 'u1',
      baselineArticulationRate: 4.2,
      baselineArticulationRateStd: 0.4,
      baselinePauseRatio: 0.18,
      baselinePauseRatioStd: 0.3,
      baselineSyllableDurationSec: 0.2,
      baselineSyllableDurationStd: 0.03,
      baselineIpuLengthSec: 1.0,
      baselineIpuLengthStd: 0.2,
      isPersonal: true,
      tachylaliaThreshold: 5.3,
      bradylaliaThreshold: 2.9,
      baselineSpeechRateWPM: null,
      baselinePitchHz: null,
      baselineLoudnessDb: null,
      baselinePauseDurationSec: null,
      baselineSpeechRatio: null,
      calibrationDurationSec: null,
      calibrationSyllableCount: null,
      calibratedAt: null,
    };
    vi.mocked(dataClient.getCalibration).mockResolvedValue(calibration);

    const { result } = renderHook(() => useCalibration('u1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(calibration));
  });

  test('polls every 15s so a calibration completed after mount is picked up without a manual reload', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(dataClient.getCalibration).mockResolvedValue({
        userId: 'u1',
        baselineArticulationRate: null,
      } as never);

      renderHook(() => useCalibration('u1'), { wrapper });

      await vi.waitFor(() => expect(dataClient.getCalibration).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => expect(dataClient.getCalibration).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
