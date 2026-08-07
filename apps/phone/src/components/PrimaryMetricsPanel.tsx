import type { MetricsUpdateEvent } from '../types';

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-2.5">
      <span className="tabular-nums text-sm font-semibold text-[var(--color-ink)]">
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-[var(--color-ink-muted)]">{unit}</span>}
      </span>
      <span className="text-center text-[9px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

const num = (v: number | null | undefined, digits = 2) => (v == null ? '—' : v.toFixed(digits));

/** Part F primary tiles — identical parameter set to the dashboard, same numbers read in either disorderMode. */
export function PrimaryMetricsPanel({ frame }: { frame: MetricsUpdateEvent | null }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Tile label="Speech Rate" value={num(frame?.speechRateWPM, 0)} unit="wpm" />
      <Tile label="Articulation" value={num(frame?.articulationRateSPS)} unit="syll/s" />
      <Tile label="Syll. Duration" value={num(frame?.averageSyllableDurationSec, 3)} unit="s" />
      <Tile label="Inter-syll. Interval" value={num(frame?.interSyllableIntervalSec, 3)} unit="s" />
      <Tile label="Pause Duration" value={num(frame?.pauseDurationSec, 2)} unit="s" />
      <Tile label="Pause Freq." value={num(frame?.pauseFrequencyPerMin, 1)} unit="/min" />
      <Tile label="Speech:Pause" value={num(frame?.speechToPauseRatio, 2)} />
      <Tile label="IPU Length" value={num(frame?.interPausalUnitLengthSec, 2)} unit="s" />
      <Tile label="Words / 30s" value={num(frame?.wordsPerLast30Sec, 1)} />
      <Tile label="Total Words" value={frame?.totalWordsSession != null ? Math.round(frame.totalWordsSession).toLocaleString() : '—'} />
      <Tile label="Total Syllables" value={frame?.totalSyllablesSession != null ? frame.totalSyllablesSession.toLocaleString() : '—'} />
    </div>
  );
}
