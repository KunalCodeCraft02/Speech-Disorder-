import clsx from 'clsx';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { formatMetric, NA } from '../lib/formatMetric';
import { PARAMS, tierForZ, type Tier } from './paramConfig';

// Tier signal is carried by `ring` (box-shadow, layers cleanly over the
// glass-surface-raised class's own border/background) plus the dot/text
// color -- not by overriding glass-surface-raised's border-color, which
// would fight CSS cascade order against a plain Tailwind border-* utility.
const TIER_STYLE: Record<Tier, { ring: string; dot: string; text: string }> = {
  uncalibrated: {
    ring: '',
    dot: 'bg-[var(--color-ink-muted)]',
    text: 'text-[var(--color-ink-muted)]',
  },
  normal: {
    ring: '',
    dot: 'bg-[var(--color-good)]',
    text: 'text-[var(--color-ink)]',
  },
  elevated: {
    ring: 'ring-1 ring-[var(--color-warning)]/40',
    dot: 'bg-[var(--color-warning)]',
    text: 'text-[var(--color-warning)]',
  },
  abnormal: {
    ring: 'ring-1 ring-[var(--color-critical)]/50',
    dot: 'bg-[var(--color-critical)]',
    text: 'text-[var(--color-critical)]',
  },
};

/**
 * All 10 monitored params, each as its own card with current value + a
 * |z|-based color tier (Part D). This is purely a display surface: a red
 * (>= 2.0) tier on any of the 7 non-composite params means only "unusual
 * for this patient right now," never a TACHYLALIA trigger — only
 * compositeZ crossing Z_TACHYLALIA (computed upstream in the classifier)
 * does that, via the ring/badge elsewhere on this screen.
 */
export function ParamGrid({ frame, calibrated }: { frame: MetricsFrame | null; calibrated: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PARAMS.map((param) => {
        const value = frame ? param.value(frame) : null;
        const z = frame ? param.z(frame) : 0;
        const tier = tierForZ(z, calibrated && frame != null && frame.classification !== 'uncalibrated');
        const style = TIER_STYLE[tier];
        const displayValue = formatMetric(value, param.digits);
        const hasValue = displayValue !== NA;

        return (
          <div
            key={param.key}
            className={clsx('glass-surface-raised flex flex-col items-center justify-center gap-1 rounded-2xl px-2 py-3 transition-all duration-300', style.ring)}
          >
            <span className={clsx('tabular-nums text-base font-semibold', hasValue ? style.text : 'text-[var(--color-ink-muted)]')}>
              {displayValue}
              {param.unit && hasValue && <span className="ml-0.5 text-[10px] font-normal text-[var(--color-ink-muted)]">{param.unit}</span>}
            </span>
            <span className="flex items-center gap-1">
              <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
              <span className="text-center text-[9px] uppercase tracking-wide text-[var(--color-ink-muted)]">{param.shortLabel}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
