export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-center">
      <p className="text-sm font-medium text-[var(--color-ink-secondary)]">{title}</p>
      {hint && <p className="text-xs text-[var(--color-ink-muted)]">{hint}</p>}
    </div>
  );
}
