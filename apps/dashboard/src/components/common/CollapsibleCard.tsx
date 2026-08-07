import { useState, type ReactNode } from 'react';
import { Card } from './Card';

interface CollapsibleCardProps {
  id?: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}

/**
 * A Card whose body starts collapsed, expanded via a header toggle button.
 * Used for the "secondary" metrics panel (Part F) — data clinicians can
 * dig into, but that shouldn't compete for attention with the primary
 * always-visible Live Session view.
 */
export function CollapsibleCard({ id, title, subtitle, children, className, defaultOpen = false }: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card
      id={id}
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-medium text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
        >
          {open ? 'Hide details' : 'Show details'}
        </button>
      }
    >
      {open ? children : <p className="text-xs text-[var(--color-ink-muted)]">Collapsed — click "Show details" to expand.</p>}
    </Card>
  );
}
