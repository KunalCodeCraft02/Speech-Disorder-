import type { DisorderMode } from '../types';

const LABEL: Record<DisorderMode, string> = {
  tachylalia: 'Tachylalia mode',
  bradylalia: 'Bradylalia mode',
};

export function DisorderModeBadge({ mode }: { mode: DisorderMode | null }) {
  if (!mode) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-ink-secondary)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
      {LABEL[mode]}
    </span>
  );
}
