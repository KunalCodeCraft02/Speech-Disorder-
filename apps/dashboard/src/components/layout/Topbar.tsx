import { ConnectionBadge } from '../common/ConnectionBadge';
import type { ConnectionState } from '../../hooks/useLiveSession';
import type { User } from '../../types';

export function Topbar({
  user,
  connectionState,
  sidebarOpen,
  onToggleSidebar,
  onReset,
  onLogout,
  demoMode,
}: {
  user: User | null;
  connectionState: ConnectionState;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onReset: () => void;
  onLogout: () => void;
  demoMode: boolean;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className="rounded-md p-1.5 text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] md:inline-flex"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
          </svg>
        </button>
        <h1 className="text-sm font-semibold text-[var(--color-ink)]">
          {sidebarOpen ? '' : 'SpeechBio · '}Speech Biofeedback Dashboard
        </h1>
        {demoMode && (
          <span className="rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">
            Demo mode
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <ConnectionBadge state={connectionState} />
        <button
          type="button"
          onClick={onReset}
          title="Clear the live gauges, charts, and feedback list on screen"
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Reset
        </button>
        <div className="hidden items-center gap-2 sm:flex">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-surface-raised)] text-xs font-semibold text-[var(--color-ink-secondary)]">
            {user?.name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <span className="text-sm text-[var(--color-ink-secondary)]">{user?.name}</span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          title="Log out"
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-ink-secondary)] hover:bg-[var(--color-surface-hover)]"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
