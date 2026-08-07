import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HistoryTable } from './HistoryTable';
import { dataClient } from '../../lib/dataClient';
import * as AuthContext from '../../context/AuthContext';
import type { Session } from '../../types';

vi.mock('../../lib/dataClient', () => ({
  dataClient: {
    listSessions: vi.fn(),
    getReportForSession: vi.fn(),
    generateSessionReport: vi.fn(),
    downloadReport: vi.fn(),
  },
}));

const COMPLETED_SESSION: Session = {
  _id: 's1',
  userId: 'u1',
  status: 'completed',
  startedAt: '2026-01-01T10:00:00.000Z',
  endedAt: '2026-01-01T10:10:00.000Z',
  summary: {
    durationSec: 600,
    avgArticulationRateSPS: 4.5,
    avgSpeechRateWPM: 550,
    avgPauseRatio: 0.2,
    tachylaliaEvents: 1,
    bradylaliaEvents: 0,
    normalRatio: 0.8,
  },
  createdAt: '2026-01-01T10:00:00.000Z',
  updatedAt: '2026-01-01T10:10:00.000Z',
};

const ACTIVE_SESSION: Session = {
  ...COMPLETED_SESSION,
  _id: 's2',
  status: 'active',
  summary: { ...COMPLETED_SESSION.summary, durationSec: 30, tachylaliaEvents: 0, normalRatio: null, avgArticulationRateSPS: null },
};

const REPORT = {
  _id: 'r1',
  userId: 'u1',
  authorId: 'u1',
  title: 'Speech Session Report',
  type: 'session' as const,
  status: 'finalized' as const,
  sessionIds: ['s1'],
  analysisResultIds: [],
  generatedAt: '2026-01-01T10:11:00.000Z',
  createdAt: '2026-01-01T10:11:00.000Z',
  updatedAt: '2026-01-01T10:11:00.000Z',
};

function mockAuth(role: 'patient' | 'clinician' | 'admin') {
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    status: 'authenticated',
    user: { id: 'u1', name: 'Test User', email: 't@example.com', role, createdAt: '2026-01-01T00:00:00.000Z' },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  });
}

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HistoryTable />
    </QueryClientProvider>
  );
}

describe('HistoryTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('shows a loading state, then an empty state when there are no sessions', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({ items: [], total: 0, page: 1, limit: 8, pages: 1 });
    mockAuth('patient');
    renderTable();

    await waitFor(() => expect(screen.getByText('No sessions yet')).toBeInTheDocument());
  });

  test('renders session rows with formatted duration and rate', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({
      items: [COMPLETED_SESSION],
      total: 1,
      page: 1,
      limit: 8,
      pages: 1,
    });
    vi.mocked(dataClient.getReportForSession).mockResolvedValue(null);
    mockAuth('patient');
    renderTable();

    await waitFor(() => expect(screen.getByText('10m 00s')).toBeInTheDocument());
    expect(screen.getByText('4.50 syll/s')).toBeInTheDocument();
    expect(screen.getByText('1 / 0')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  test('an active session shows a dash in the Report column and no report lookup', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({
      items: [ACTIVE_SESSION],
      total: 1,
      page: 1,
      limit: 8,
      pages: 1,
    });
    mockAuth('patient');
    renderTable();

    await waitFor(() => expect(screen.getByText('active')).toBeInTheDocument());
    expect(dataClient.getReportForSession).not.toHaveBeenCalled();
  });

  test('a completed session with an existing report shows a Download button', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({
      items: [COMPLETED_SESSION],
      total: 1,
      page: 1,
      limit: 8,
      pages: 1,
    });
    vi.mocked(dataClient.getReportForSession).mockResolvedValue(REPORT);
    vi.mocked(dataClient.downloadReport).mockResolvedValue(undefined);
    mockAuth('patient');
    renderTable();

    const downloadButton = await screen.findByRole('button', { name: 'Download PDF' });
    await userEvent.click(downloadButton);

    await waitFor(() => expect(dataClient.downloadReport).toHaveBeenCalledWith(REPORT));
  });

  test('a patient sees "Pending" (not a Generate button) when no report exists yet', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({
      items: [COMPLETED_SESSION],
      total: 1,
      page: 1,
      limit: 8,
      pages: 1,
    });
    vi.mocked(dataClient.getReportForSession).mockResolvedValue(null);
    mockAuth('patient');
    renderTable();

    await waitFor(() => expect(screen.getByText('Pending')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Generate report' })).not.toBeInTheDocument();
  });

  test('a clinician sees a Generate report button when no report exists yet, and it triggers generation', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({
      items: [COMPLETED_SESSION],
      total: 1,
      page: 1,
      limit: 8,
      pages: 1,
    });
    vi.mocked(dataClient.getReportForSession).mockResolvedValue(null);
    vi.mocked(dataClient.generateSessionReport).mockResolvedValue(REPORT);
    mockAuth('clinician');
    renderTable();

    const generateButton = await screen.findByRole('button', { name: 'Generate report' });
    await userEvent.click(generateButton);

    await waitFor(() => expect(dataClient.generateSessionReport).toHaveBeenCalledWith('s1'));
    await screen.findByRole('button', { name: 'Download PDF' });
  });

  test('pagination controls are disabled appropriately at the boundaries', async () => {
    vi.mocked(dataClient.listSessions).mockResolvedValue({
      items: [COMPLETED_SESSION],
      total: 1,
      page: 1,
      limit: 8,
      pages: 1,
    });
    vi.mocked(dataClient.getReportForSession).mockResolvedValue(null);
    mockAuth('patient');
    renderTable();

    await waitFor(() => expect(screen.getByText('Page 1 of 1 · 1 sessions')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
