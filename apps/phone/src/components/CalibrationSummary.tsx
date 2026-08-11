import type { CalibrationRecord } from '../storage/calibration';

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-3">
      <span className="tabular-nums text-xl font-semibold text-[var(--color-ink)]">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">{unit}</span>}
      </span>
      <span className="text-center text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

const fmt = (v: number | null, digits = 1) => (v == null ? '—' : v.toFixed(digits));

export function CalibrationSummary({ profile }: { profile: CalibrationRecord }) {
  return (
    <div className="flex w-full flex-col gap-4">
      {profile.isPersonal ? (
        <span className="mx-auto inline-flex items-center rounded-full border border-[var(--color-good)]/40 bg-[var(--color-good)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--color-good)]">
          Personal baseline — z-score classification
        </span>
      ) : (
        <span className="mx-auto inline-flex items-center rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--color-warning)]">
          No personal std — lower-confidence fallback
        </span>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Speech Rate" value={fmt(profile.baselineSpeechRateWPM, 0)} unit="wpm" />
        <Stat label="Articulation Rate" value={fmt(profile.baselineArticulationRate, 2)} unit="syll/s" />
        <Stat label="Pitch" value={fmt(profile.baselineMeanPitchHz, 0)} unit="Hz" />
        <Stat label="Loudness" value={fmt(profile.baselineLoudnessDb, 1)} unit="dB" />
        <Stat label="Pause Duration" value={fmt(profile.baselinePauseDurationSec, 2)} unit="sec" />
        <Stat
          label="Speech Ratio"
          value={profile.baselineSpeechRatio == null ? '—' : Math.round(profile.baselineSpeechRatio * 100).toString()}
          unit="%"
        />
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-ink-muted)]">Tachylalia threshold</span>
          <span className="tabular-nums font-medium text-[var(--color-critical)]">
            {fmt(profile.tachylaliaThreshold, 2)} syll/s
          </span>
        </div>
      </div>

      <p className="text-center text-xs text-[var(--color-ink-muted)]">
        Calibrated from a {profile.durationSec ? Math.round(profile.durationSec) : '—'}s reading
        {profile.calibratedAt && ` · ${new Date(profile.calibratedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
      </p>
    </div>
  );
}
