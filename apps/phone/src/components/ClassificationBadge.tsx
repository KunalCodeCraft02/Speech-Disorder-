import type { Classification } from '../dsp/classifier';

const CONFIG: Record<Classification, { label: string; color: string; glow: string }> = {
  uncalibrated: { label: 'Calibration Required', color: 'var(--color-ink-muted)', glow: 'rgba(138,143,163,0.16)' },
  normal: { label: 'Normal', color: 'var(--color-good)', glow: 'rgba(21,128,61,0.14)' },
  tachylalia: { label: 'Too Fast', color: 'var(--color-critical)', glow: 'rgba(220,38,38,0.16)' },
};

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

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="flex h-32 w-32 items-center justify-center rounded-full border-2 text-base font-semibold transition-all duration-300"
        style={{
          borderColor: cfg?.color ?? 'var(--color-border-strong)',
          color: cfg?.color ?? 'var(--color-ink-muted)',
          boxShadow: cfg ? `0 0 0 10px ${cfg.glow}` : undefined,
        }}
      >
        {cfg ? cfg.label : active ? 'Listening…' : 'Not Recording'}
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">Current Classification</p>
      {active && confidence != null && (
        <p className="text-xs text-[var(--color-ink-secondary)]">
          Confidence <span className="tabular-nums font-semibold text-[var(--color-ink)]">{Math.round(confidence * 100)}%</span>
        </p>
      )}
    </div>
  );
}
