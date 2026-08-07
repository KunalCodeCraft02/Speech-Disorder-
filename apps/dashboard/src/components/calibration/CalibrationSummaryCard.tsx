import { useCalibration } from '../../hooks/useSessionQueries';
import { EmptyState } from '../common/EmptyState';

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-[var(--color-ink-muted)]">{label}</span>
      <span className="tabular-nums text-lg font-semibold text-[var(--color-ink)]">
        {value} {unit && <span className="text-xs font-normal text-[var(--color-ink-muted)]">{unit}</span>}
      </span>
    </div>
  );
}

function MiniStat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-2 py-2">
      <span className="tabular-nums text-sm font-semibold text-[var(--color-ink)]">
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-[var(--color-ink-muted)]">{unit}</span>}
      </span>
      <span className="text-center text-[9px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

const fmt = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toFixed(digits));

export function CalibrationSummaryCard({ userId }: { userId: string | undefined }) {
  const { data, isLoading } = useCalibration(userId);

  if (isLoading) return <EmptyState title="Loading calibration…" />;

  if (!data || data.baselineArticulationRate == null) {
    return <EmptyState title="Not calibrated" hint="Run a calibration pass to set patient-specific thresholds" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        {data.isPersonal ? (
          <span className="inline-flex items-center rounded-full border border-[var(--color-good)]/40 bg-[var(--color-good)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--color-good)]">
            Personal baseline — z-score classification
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--color-warning)]">
            No personal std — lower-confidence fallback classification
          </span>
        )}
      </div>

      {/* Descriptive baseline, from the "read this passage" calibration reading(s) */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Speech Rate" value={fmt(data.baselineSpeechRateWPM, 0)} unit="wpm" />
        <MiniStat label="Pitch" value={fmt(data.baselinePitchHz, 0)} unit="Hz" />
        <MiniStat label="Loudness" value={fmt(data.baselineLoudnessDb, 1)} unit="dB" />
        <MiniStat label="Pause Duration" value={fmt(data.baselinePauseDurationSec, 2)} unit="sec" />
        <MiniStat
          label="Speech Ratio"
          value={data.baselineSpeechRatio == null ? '—' : Math.round(data.baselineSpeechRatio * 100).toString()}
          unit="%"
        />
        <MiniStat label="Articulation Rate" value={fmt(data.baselineArticulationRate, 2)} unit="syll/s" />
      </div>

      {/* Classifier baseline — drives real-time Tachylalia/Bradylalia detection */}
      <div className="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-3">
        <Stat label="Baseline pause ratio" value={fmt(data.baselinePauseRatio, 2)} />
        <Stat label="Tachylalia threshold" value={fmt(data.tachylaliaThreshold, 2)} unit="syll/s" />
        <Stat label="Bradylalia threshold" value={fmt(data.bradylaliaThreshold, 2)} unit="syll/s" />
      </div>

      <div className="border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-ink-muted)]">
        Calibrated from a {data.calibrationDurationSec ? Math.round(data.calibrationDurationSec) : '—'}s reading
        {data.calibratedAt && ` · ${new Date(data.calibratedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}`}
      </div>
    </div>
  );
}
