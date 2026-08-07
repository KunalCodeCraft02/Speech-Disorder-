import { useState } from 'react';
import clsx from 'clsx';
import { useSessionsList } from '../../hooks/useSessionQueries';
import { useDownloadReport, useGenerateSessionReport, useSessionReport } from '../../hooks/useReportQueries';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../common/EmptyState';
import type { Session } from '../../types';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'text-[var(--color-good)] bg-[var(--color-good)]/10',
  completed: 'text-[var(--color-ink-secondary)] bg-white/5',
  aborted: 'text-[var(--color-critical)] bg-[var(--color-critical)]/10',
};

// Sessions auto-generate their PDF report on completion (see gateway's
// sessionService.endSession), so this is a download link in the common
// case; clinicians/admins additionally get a fallback "Generate" action for
// older sessions that predate that pipeline (or whose generation failed).
function ReportCell({ session }: { session: Session }) {
  const { user } = useAuth();
  const canGenerate = user?.role === 'clinician' || user?.role === 'admin';
  const enabled = session.status === 'completed';

  const { data: report, isLoading } = useSessionReport(session._id, enabled);
  const generateReport = useGenerateSessionReport(session._id);
  const downloadReport = useDownloadReport();

  if (!enabled) {
    return <span className="text-[var(--color-ink-muted)]">—</span>;
  }

  if (isLoading) {
    return <span className="text-[var(--color-ink-muted)]">…</span>;
  }

  if (report) {
    return (
      <button
        type="button"
        onClick={() => downloadReport.mutate(report)}
        disabled={downloadReport.isPending}
        className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)] hover:bg-white/5 disabled:opacity-40"
      >
        {downloadReport.isPending ? 'Downloading…' : 'Download PDF'}
      </button>
    );
  }

  if (canGenerate) {
    return (
      <button
        type="button"
        onClick={() => generateReport.mutate()}
        disabled={generateReport.isPending}
        className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)] hover:bg-white/5 disabled:opacity-40"
      >
        {generateReport.isPending ? 'Generating…' : 'Generate report'}
      </button>
    );
  }

  return <span className="text-[var(--color-ink-muted)]">Pending</span>;
}

// The gateway scopes /sessions to the caller's own patient id server-side
// (sessions.controller.js listSessions), so no userId needs to be passed here.
export function HistoryTable() {
  const [page, setPage] = useState(1);
  const limit = 8;
  const { data, isLoading } = useSessionsList({ page, limit });

  if (isLoading) {
    return <EmptyState title="Loading session history…" />;
  }

  if (!data || data.items.length === 0) {
    return <EmptyState title="No sessions yet" hint="Completed sessions will appear here" />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              <th className="pb-2 pr-3 font-medium">Started</th>
              <th className="pb-2 pr-3 font-medium">Duration</th>
              <th className="pb-2 pr-3 font-medium">Avg rate</th>
              <th className="pb-2 pr-3 font-medium">Tachy / Brady</th>
              <th className="pb-2 pr-3 font-medium">Normal</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 font-medium">Report</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((session) => (
              <tr key={session._id} className="border-t border-[var(--color-border)]">
                <td className="py-2 pr-3 text-[var(--color-ink)]">{formatDate(session.startedAt)}</td>
                <td className="py-2 pr-3 tabular-nums text-[var(--color-ink-secondary)]">
                  {formatDuration(session.summary.durationSec)}
                </td>
                <td className="py-2 pr-3 tabular-nums text-[var(--color-ink-secondary)]">
                  {session.summary.avgArticulationRateSPS != null
                    ? `${session.summary.avgArticulationRateSPS.toFixed(2)} syll/s`
                    : '—'}
                </td>
                <td className="py-2 pr-3 tabular-nums text-[var(--color-ink-secondary)]">
                  {session.summary.tachylaliaEvents} / {session.summary.bradylaliaEvents}
                </td>
                <td className="py-2 pr-3 tabular-nums text-[var(--color-ink-secondary)]">
                  {session.summary.normalRatio != null ? `${Math.round(session.summary.normalRatio * 100)}%` : '—'}
                </td>
                <td className="py-2 pr-3">
                  <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLE[session.status])}>
                    {session.status}
                  </span>
                </td>
                <td className="py-2">
                  <ReportCell session={session} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--color-ink-muted)]">
        <span>
          Page {data.page} of {data.pages} · {data.total} sessions
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={page >= data.pages}
            onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
