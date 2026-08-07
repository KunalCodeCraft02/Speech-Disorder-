import type { ReactNode } from 'react';
import clsx from 'clsx';

interface CardProps {
  id?: string;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}

export function Card({ id, title, subtitle, actions, children, className, bodyClassName, padded = true }: CardProps) {
  return (
    <section
      id={id}
      className={clsx(
        'flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]',
        className
      )}
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div>
            {title && <h3 className="text-sm font-semibold tracking-wide text-[var(--color-ink)]">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-4', 'flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}
