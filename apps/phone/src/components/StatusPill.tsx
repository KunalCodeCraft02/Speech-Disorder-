import clsx from 'clsx';

export function StatusPill({ label, color, pulse }: { label: string; color: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-xs font-medium">
      <span className="relative flex h-2 w-2">
        {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: color }} />}
        <span className={clsx('relative inline-flex h-2 w-2 rounded-full')} style={{ background: color }} />
      </span>
      <span style={{ color }}>{label}</span>
    </div>
  );
}
