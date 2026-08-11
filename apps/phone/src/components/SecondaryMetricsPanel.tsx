import { useState } from 'react';
import type { MetricsFrame } from '../dsp/sessionPipeline';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-2">
      <span className="tabular-nums text-xs font-semibold text-[var(--color-ink)]">{value}</span>
      <span className="text-center text-[9px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

const num = (v: number | null | undefined, digits = 2, unit = '') => (v == null ? '—' : `${v.toFixed(digits)}${unit}`);

/**
 * Extra session diagnostics not covered by the 10 param cards (ParamGrid) —
 * decision audit (confidence/sample gate), trend, and cumulative counters.
 * Collapsed by default so the Main screen stays focused on the ring + the
 * 10 cards. Disfluency rate / repetition rate / false starts have no DSP
 * computation defined anywhere in the classification engine spec — shown
 * as "not available" rather than fabricated.
 */
export function SecondaryMetricsPanel({ frame }: { frame: MetricsFrame | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2.5 text-xs font-semibold text-[var(--color-ink-secondary)]"
      >
        More Details
        <span className="text-[var(--color-ink-muted)]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-border)] p-3">
          <Tile label="composite_z" value={num(frame?.compositeZ)} />
          <Tile label="Confidence" value={frame?.confidence != null ? `${Math.round(frame.confidence * 100)}%` : '—'} />
          <Tile label="Sample OK" value={frame?.sampleSufficient == null ? '—' : frame.sampleSufficient ? 'Yes' : 'No'} />
          <Tile label="Rate Trend" value={num(frame?.rateTrend, 3)} />
          <Tile label="Composite Score" value={num(frame?.compositeScore, 0)} />
          <Tile label="Recovery Time" value={num(frame?.recoveryTimeSec, 1, ' s')} />
          <Tile label="Words / 30s" value={num(frame?.wordsPerLast30Sec, 1)} />
          <Tile label="Total Words" value={frame?.totalWordsSession != null ? Math.round(frame.totalWordsSession).toLocaleString() : '—'} />
          <Tile label="Total Syllables" value={frame?.totalSyllablesSession != null ? frame.totalSyllablesSession.toLocaleString() : '—'} />
          <Tile label="Disfluency Rate" value="—" />
          <Tile label="Repetition Rate" value="—" />
          <Tile label="False Starts" value="—" />
        </div>
      )}
    </div>
  );
}
