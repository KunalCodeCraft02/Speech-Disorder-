import type { Classification } from '../dsp/classifier';

const CONFIG: Record<Classification, { label: string; color: string; glow: string }> = {
  uncalibrated: { label: 'Calibration Required', color: 'var(--color-ink-muted)', glow: 'rgba(108,117,144,0.22)' },
  normal: { label: 'Normal', color: 'var(--color-good)', glow: 'rgba(43,196,107,0.28)' },
  tachylalia: { label: 'Too Fast', color: 'var(--color-critical)', glow: 'rgba(242,86,79,0.32)' },
};

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ClassificationBadge({
  classification,
  confidence,
  active,
}: {
  classification: Classification | null;
  confidence: number | null;
  active: boolean;
}) {
  const cfg = active && classification ? CONFIG[classification] : null;
  const pct = active && confidence != null ? Math.round(Math.min(1, Math.max(0, confidence)) * 100) : 0;
  const offset = CIRCUMFERENCE * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex h-32 w-32 items-center justify-center">
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--color-border)" strokeWidth="8" />
          {cfg && (
            <circle
              cx="60"
              cy="60"
              r={RADIUS}
              fill="none"
              stroke={cfg.color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 400ms ease, stroke 300ms ease' }}
            />
          )}
        </svg>
        <div
          className="flex h-24 w-24 flex-col items-center justify-center rounded-full text-center transition-all duration-300"
          style={{
            color: cfg?.color ?? 'var(--color-ink-muted)',
            boxShadow: cfg ? `0 0 22px 2px ${cfg.glow}` : undefined,
          }}
        >
          <span className="px-2 text-sm font-semibold leading-tight">{cfg ? cfg.label : active ? 'Listening…' : 'Not Recording'}</span>
          {cfg && confidence != null && <span className="mt-0.5 tabular-nums text-xs font-medium text-[var(--color-ink-muted)]">{pct}%</span>}
        </div>
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">Current Classification</p>
      {active && confidence != null && (
        <p className="text-xs text-[var(--color-ink-secondary)]">
          Confidence <span className="tabular-nums font-semibold text-[var(--color-ink)]">{pct}%</span>
        </p>
      )}
    </div>
  );
}
