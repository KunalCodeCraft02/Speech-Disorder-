import type { MetricsFrame } from '../../types';

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-4">
      <span className="text-2xl font-semibold tabular-nums text-[var(--color-ink)]">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">{unit}</span>}
      </span>
      <span className="text-center text-xs text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

/**
 * Part F primary tiles: Words per 30 sec (its own independent trailing
 * window, unrelated to the 4s classification window) and a cumulative
 * words/syllables counter that only ever increments through a session.
 */
export function PrimaryCountersPanel({ frame }: { frame: MetricsFrame | null }) {
  const wordsPer30 = frame?.wordsPerLast30Sec;
  const totalWords = frame?.totalWordsSession;
  const totalSyllables = frame?.totalSyllablesSession;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile label="Words / 30 sec" value={wordsPer30 != null ? wordsPer30.toFixed(1) : '—'} />
      <Tile label="Cumulative Words" value={totalWords != null ? Math.round(totalWords).toLocaleString() : '—'} />
      <Tile label="Cumulative Syllables" value={totalSyllables != null ? totalSyllables.toLocaleString() : '—'} />
    </div>
  );
}
