import clsx from 'clsx';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { formatMetric, NA } from '../lib/formatMetric';
import { PARAMS, tierForZ, type Tier } from './paramConfig';

// Item 6: two-color only when calibrated -- 'normal' is neutral/white
// (ring, dot, AND number text all follow the same rule, no amber/middle
// state), 'abnormal' is red across all three. 'uncalibrated' stays its own
// distinct grey state (a "no baseline yet" fact, not a value reading).
const TIER_STYLE: Record<Tier, { ring: string; dot: string; text: string }> = {
  uncalibrated: {
    ring: '',
    dot: 'bg-[var(--color-ink-muted)]',
    text: 'text-[var(--color-ink-muted)]',
  },
  normal: {
    ring: '',
    dot: 'bg-[var(--color-ink-muted)]',
    text: 'text-[var(--color-ink)]',
  },
  abnormal: {
    ring: 'ring-1 ring-[var(--color-critical)]/50',
    dot: 'bg-[var(--color-critical)]',
    text: 'text-[var(--color-critical)]',
  },
};

/**
 * The main-screen param cards, each with current value + a |z|-based
 * two-color tier (item 6): |z| >= settings.zTachylalia -> red on the card
 * AND the number, otherwise neutral/white on both -- no amber/elevated
 * state. This is purely a display surface: a red tier on any
 * `feedsComposite: false` param means only "unusual for this patient right
 * now, at the same margin that WOULD trigger TACHYLALIA if this were
 * compositeZ or zWordsPer30Sec," never a trigger by itself -- only those
 * two crossing zTachylalia (computed upstream in the classifier) actually
 * confirms TACHYLALIA, via the ring/badge elsewhere on this screen.
 */
export function ParamGrid({ frame, calibrated }: { frame: MetricsFrame | null; calibrated: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PARAMS.map((param) => {
        const value = frame ? param.value(frame) : null;
        const z = frame ? param.z(frame) : 0;
        const active = calibrated && frame != null && frame.classification !== 'uncalibrated';
        const tier = tierForZ(z, active);
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
