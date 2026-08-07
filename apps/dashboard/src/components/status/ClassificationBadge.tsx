import { AnimatePresence, motion } from 'framer-motion';
import type { Classification } from '../../types';

const CONFIG: Record<Classification, { label: string; description: string; color: string; glow: string }> = {
  uncalibrated: {
    label: 'Uncalibrated',
    description: 'Run calibration to enable tachylalia/bradylalia detection for this patient',
    color: 'var(--color-ink-muted)',
    glow: 'rgba(148,148,148,0.22)',
  },
  normal: {
    label: 'Normal',
    description: 'Articulation rate within calibrated range',
    color: 'var(--color-good)',
    glow: 'rgba(12,163,12,0.28)',
  },
  tachylalia: {
    label: 'Tachylalia',
    description: 'Speech rate above threshold — too fast',
    color: 'var(--color-critical)',
    glow: 'rgba(208,59,59,0.32)',
  },
  bradylalia: {
    label: 'Bradylalia',
    description: 'Speech rate below threshold — too slow',
    color: 'var(--color-warning)',
    glow: 'rgba(250,178,25,0.30)',
  },
};

export function ClassificationBadge({
  classification,
  confidence,
}: {
  classification: Classification | null;
  confidence: number | null;
}) {
  const cfg = classification ? CONFIG[classification] : null;

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-2">
      <AnimatePresence mode="wait">
        <motion.div
          key={classification ?? 'unknown'}
          initial={{ opacity: 0, scale: 0.9, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: -4 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="flex flex-col items-center gap-2"
        >
          <div
            className="flex h-24 w-24 items-center justify-center rounded-full border-2 text-sm font-semibold"
            style={{
              borderColor: cfg?.color ?? 'var(--color-border-strong)',
              color: cfg?.color ?? 'var(--color-ink-muted)',
              boxShadow: cfg ? `0 0 0 8px ${cfg.glow}` : undefined,
            }}
          >
            {cfg?.label ?? 'Awaiting data'}
          </div>
          <p className="max-w-[220px] text-center text-xs text-[var(--color-ink-muted)]">
            {cfg?.description ?? 'No live classification yet'}
          </p>
        </motion.div>
      </AnimatePresence>
      {confidence != null && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-ink-secondary)]">
          <span>Confidence</span>
          <span className="tabular-nums font-medium text-[var(--color-ink)]">{Math.round(confidence * 100)}%</span>
        </div>
      )}
    </div>
  );
}
