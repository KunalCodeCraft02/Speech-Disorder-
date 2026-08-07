import clsx from 'clsx';
import type { ConnectionState } from '../../hooks/useLiveSession';

const CONFIG: Record<ConnectionState, { label: string; dot: string; text: string }> = {
  connected: { label: 'Live', dot: 'bg-[var(--color-good)]', text: 'text-[var(--color-good)]' },
  connecting: { label: 'Connecting…', dot: 'bg-[var(--color-warning)]', text: 'text-[var(--color-warning)]' },
  disconnected: { label: 'Disconnected', dot: 'bg-[var(--color-ink-muted)]', text: 'text-[var(--color-ink-muted)]' },
  error: { label: 'Connection error', dot: 'bg-[var(--color-critical)]', text: 'text-[var(--color-critical)]' },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const cfg = CONFIG[state];
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-xs font-medium">
      <span className="relative flex h-2 w-2">
        <span
          className={clsx('absolute inline-flex h-full w-full rounded-full opacity-75', cfg.dot, state === 'connected' && 'animate-ping')}
        />
        <span className={clsx('relative inline-flex h-2 w-2 rounded-full', cfg.dot)} />
      </span>
      <span className={cfg.text}>{cfg.label}</span>
    </div>
  );
}
