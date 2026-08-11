import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateDailyInsight, getDailySummary, type DailySummary } from '../storage/insights';
import { formatMetric } from '../lib/formatMetric';
import { useCurrentUser } from '../context/CurrentUserContext';

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="glass-surface-raised flex flex-col items-center gap-0.5 rounded-xl px-3 py-3">
      <span className="tabular-nums text-xl font-semibold text-[var(--color-ink)]">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">{unit}</span>}
      </span>
      <span className="text-center text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

function formatMinutes(sec: number): string {
  const minutes = Math.round(sec / 60);
  return minutes < 1 ? `${Math.round(sec)}s` : `${minutes}`;
}

/**
 * End-of-day insight screen: a plain-language local summary computed
 * entirely from locally stored session data (storage/insights.ts) — no
 * PDF, no server. Available on-demand at any time, not just at midnight.
 */
export function TodayPage() {
  const navigate = useNavigate();
  const { logout } = useCurrentUser();
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getDailySummary(), generateDailyInsight()]).then(([dailySummary, text]) => {
      if (cancelled) return;
      setSummary(dailySummary);
      setInsight(text);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[var(--color-plane)] px-5"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <header className="flex shrink-0 items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] active:bg-[var(--color-surface-hover)]"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold text-[var(--color-ink)]">Today</h1>
        <span className="w-10" />
      </header>

      {loading || !summary ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-ink-muted)]">Loading…</div>
      ) : (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="glass-surface rounded-2xl p-4">
            <p className="text-sm leading-relaxed text-[var(--color-ink-secondary)]">{insight}</p>
          </div>

          {summary.sessionCount > 0 && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="Practice Time" value={formatMinutes(summary.totalPracticeSec)} unit="min" />
                <Stat label="Sessions" value={String(summary.sessionCount)} />
                <Stat label="Time Too Fast" value={Math.round(summary.tachylaliaPercent).toString()} unit="%" />
                <Stat label="Alerts" value={String(summary.feedbackTriggerCount)} />
              </div>

              <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Sessions</h2>
              <div className="flex flex-col gap-2">
                {summary.sessions.map((s) => (
                  <div key={s.id} className="glass-surface-raised flex items-center justify-between rounded-xl px-4 py-3">
                    <span className="text-sm text-[var(--color-ink-secondary)]">
                      {new Date(s.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className="tabular-nums text-sm font-semibold text-[var(--color-ink)]">{formatMinutes(s.durationSec)} min</span>
                    <span className="tabular-nums text-sm text-[var(--color-ink-muted)]">{formatMetric(s.avgArticulationRateSPS, 2, ' syll/s')}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={logout}
            className="mt-6 mb-2 w-full text-center text-xs font-medium text-[var(--color-ink-muted)] active:text-[var(--color-ink-secondary)]"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
