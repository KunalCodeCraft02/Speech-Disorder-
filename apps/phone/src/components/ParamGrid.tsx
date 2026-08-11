import clsx from 'clsx';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { PARAMS, tierForZ, type Tier } from './paramConfig';

const TIER_STYLE: Record<Tier, { border: string; ring: string; dot: string; text: string }> = {
  uncalibrated: {
    border: 'border-[var(--color-border)]',
    ring: '',
    dot: 'bg-[var(--color-ink-muted)]',
    text: 'text-[var(--color-ink-muted)]',
  },
  normal: {
    border: 'border-[var(--color-border-strong)]',
    ring: '',
    dot: 'bg-[var(--color-good)]',
    text: 'text-[var(--color-ink)]',
  },
  elevated: {
    border: 'border-[var(--color-warning)]/50',
    ring: 'ring-1 ring-[var(--color-warning)]/20',
    dot: 'bg-[var(--color-warning)]',
    text: 'text-[var(--color-warning)]',
  },
  abnormal: {
    border: 'border-[var(--color-critical)]/60',
    ring: 'ring-1 ring-[var(--color-critical)]/25',
    dot: 'bg-[var(--color-critical)]',
    text: 'text-[var(--color-critical)]',
  },
};

const fmt = (v: number | null, digits: number) => (v == null ? '—' : v.toFixed(digits));

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

        return (
          <div
            key={param.key}
            className={clsx(
              'flex flex-col items-center justify-center gap-1 rounded-xl border bg-[var(--color-surface-raised)] px-2 py-3 transition-colors duration-300',
              style.border,
              style.ring
            )}
          >
            <span className={clsx('tabular-nums text-base font-semibold', style.text)}>
              {fmt(value, param.digits)}
              {param.unit && <span className="ml-0.5 text-[10px] font-normal text-[var(--color-ink-muted)]">{param.unit}</span>}
            </span>
            <span className="flex items-center gap-1">
              <span className={clsx('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden="true" />
              <span className="text-center text-[9px] uppercase tracking-wide text-[var(--color-ink-muted)]">{param.shortLabel}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
