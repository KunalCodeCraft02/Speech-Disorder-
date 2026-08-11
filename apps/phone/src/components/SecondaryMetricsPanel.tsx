import { useState } from 'react';
import type { MetricsFrame } from '../dsp/sessionPipeline';
import { formatMetric, formatCount, formatPercent, NA } from '../lib/formatMetric';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-surface-raised flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2">
      <span className={`tabular-nums text-xs font-semibold ${value === NA ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-ink)]'}`}>{value}</span>
      <span className="text-center text-[9px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

/**
 * Extra session diagnostics not covered by the 10 param cards (ParamGrid) —
 * decision audit (confidence/sample gate), trend, and cumulative counters.
 * Collapsed by default so the Main screen stays focused on the ring + the
 * 10 cards.
 *
 * Disfluency rate / repetition rate / false starts have no DSP computation
 * anywhere in this app's pipeline -- there is no transcription/ASR stage,
 * so per-word repetition or false-start detection genuinely cannot be
 * computed from audio-only features. They are shown as N/A rather than a
 * fabricated 0 or an unlabeled dash (Part 15/20).
 */
export function SecondaryMetricsPanel({ frame }: { frame: MetricsFrame | null }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-surface rounded-xl">
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
          <Tile label="composite_z" value={formatMetric(frame?.compositeZ)} />
          <Tile label="Confidence" value={formatPercent(frame ? frame.confidence * 100 : null)} />
          <Tile label="Sample OK" value={frame?.sampleSufficient == null ? NA : frame.sampleSufficient ? 'Yes' : 'No'} />
          <Tile label="Rate Trend" value={formatMetric(frame?.rateTrend, 3)} />
          <Tile label="Composite Score" value={formatMetric(frame?.compositeScore, 0)} />
          <Tile label="Recovery Time" value={formatMetric(frame?.recoveryTimeSec, 1, ' s')} />
          <Tile label="Pause Count" value={formatCount(frame?.pauseCount)} />
          <Tile label="IPU Count" value={formatCount(frame?.ipuCount)} />
          <Tile label="Speaking Time" value={formatMetric(frame?.speakingDurationSec, 1, ' s')} />
          <Tile label="Words / 30s" value={formatMetric(frame?.wordsPerLast30Sec, 1)} />
          <Tile label="Total Words" value={formatCount(frame?.totalWordsSession)} />
          <Tile label="Total Syllables" value={formatCount(frame?.totalSyllablesSession)} />
          <Tile label="Disfluency Rate" value={NA} />
          <Tile label="Repetition Rate" value={NA} />
          <Tile label="False Starts" value={NA} />
        </div>
      )}
    </div>
  );
}
