import type { DisorderMode } from '../../types';

const LABEL: Record<DisorderMode, string> = {
  tachylalia: 'Tachylalia mode',
  bradylalia: 'Bradylalia mode',
};

/** Shows which single disorder direction the active session is scoped to (Part B.8/D). */
export function DisorderModeBadge({ mode }: { mode: DisorderMode | null }) {
  if (!mode) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1 text-xs font-medium text-[var(--color-ink-secondary)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-rate)]" />
      {LABEL[mode]}
    </span>
  );
}
