import clsx from 'clsx';
import type { ConnectionLogEntry, ConnectionLogLevel } from '../../hooks/useLiveSession';

const DOT_COLOR: Record<ConnectionLogLevel, string> = {
  info: 'bg-[var(--color-ink-muted)]',
  success: 'bg-[var(--color-good)]',
  warn: 'bg-[var(--color-warning)]',
  error: 'bg-[var(--color-critical)]',
};

const TEXT_COLOR: Record<ConnectionLogLevel, string> = {
  info: 'text-[var(--color-ink-secondary)]',
  success: 'text-[var(--color-good)]',
  warn: 'text-[var(--color-warning)]',
  error: 'text-[var(--color-critical)]',
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ConnectionLogPanel({ entries }: { entries: ConnectionLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--color-ink-muted)]">No connection activity yet.</p>;
  }

  return (
    <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1 font-mono text-xs">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-2">
          <span className={clsx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', DOT_COLOR[entry.level])} aria-hidden />
          <span className="shrink-0 tabular-nums text-[var(--color-ink-muted)]">{formatTime(entry.ts)}</span>
          <span className={clsx('break-words', TEXT_COLOR[entry.level])}>{entry.message}</span>
        </li>
      ))}
    </ul>
  );
}
