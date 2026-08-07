import type { MetricsFrame } from '../../types';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2.5">
      <span className="text-xs text-[var(--color-ink-muted)]">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-[var(--color-ink)]">{value}</span>
      {hint && <span className="text-[10px] text-[var(--color-ink-muted)]">{hint}</span>}
    </div>
  );
}

const num = (v: number | null | undefined, digits = 2, unit = '') => (v == null ? '—' : `${v.toFixed(digits)}${unit}`);

/**
 * Part F secondary/expandable panel — decision-audit and descriptive
 * fields that clinicians may want to dig into but that shouldn't compete
 * for attention with the primary Live Session view.
 *
 * Disfluency rate / word-phrase repetition rate / false starts are listed
 * in the spec's secondary parameter set, but no DSP computation for them
 * was ever defined (Parts A-C only specify rate/pause/pitch/z-score
 * features) — shown here as explicitly "not available" rather than
 * fabricated, so the panel's shape matches the spec without inventing an
 * unrequested disfluency-detection algorithm.
 */
export function SecondaryMetricsPanel({ frame }: { frame: MetricsFrame | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Classification audit</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="z_rate" value={num(frame?.zRate)} />
          <Stat label="z_pause" value={num(frame?.zPause)} />
          <Stat label="z_syll" value={num(frame?.zSyll)} />
          <Stat label="composite_z" value={num(frame?.compositeZ)} />
          <Stat label="Confidence" value={frame?.confidence != null ? `${Math.round(frame.confidence * 100)}%` : '—'} />
          <Stat label="Sample sufficient" value={frame?.sampleSufficient == null ? '—' : frame.sampleSufficient ? 'Yes' : 'No'} />
          <Stat label="Rate trend" value={num(frame?.rateTrend, 3, ' syll/s²')} />
          <Stat label="Time in abnormal state" value={num(frame?.timeInAbnormalStateSec, 1, ' s')} />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Prosody</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="F0 Mean" value={num(frame?.meanPitchHz, 0, ' Hz')} />
          <Stat label="F0 Variability" value={num(frame?.pitchVariabilityHz, 1, ' Hz')} />
          <Stat label="F0 Trend" value={num(frame?.meanPitchTrendHz, 2, ' Hz/s')} />
          <Stat label="Loudness variability" value={num(frame?.loudnessVariabilityDb, 2, ' dB')} />
          <Stat label="Composite score" value={num(frame?.compositeScore, 0)} hint="General wellness score — not the tachylalia/bradylalia signal" />
          <Stat label="Recovery time" value={num(frame?.recoveryTimeSec, 1, ' s')} hint="Time from last alert to next confirmed normal" />
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Disfluency (not yet available)</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="Disfluency rate" value="—" />
          <Stat label="Word/phrase repetition rate" value="—" />
          <Stat label="False starts" value="—" />
        </div>
      </div>
    </div>
  );
}
