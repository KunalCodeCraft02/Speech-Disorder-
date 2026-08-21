import type { CalibrationRecord } from '../storage/calibration';
import { formatMetric, formatPercent } from '../lib/formatMetric';
import { settings } from '../dsp/config';
import * as C from '../dsp/constants';

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="glass-surface-raised flex flex-col items-center gap-0.5 rounded-xl px-3 py-3">
      <span className="tabular-nums text-xl font-semibold text-[var(--color-ink)]">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-[var(--color-ink-muted)]">{unit}</span>}
      </span>
      <span className="text-center text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">{label}</span>
    </div>
  );
}

const fmt = formatMetric;

export function CalibrationSummary({ profile }: { profile: CalibrationRecord }) {
  // Part I: derive a personalized WPM alert threshold from this patient's
  // calibrated baseline -- words/30sec is the primitive (half of WPM, by
  // definition: 30s = half a minute), WPM is derived from it, and the
  // threshold follows the same baseline*multiplier pattern as the existing
  // (articulation-rate) tachylaliaThreshold below, just expressed in
  // WPM/words-per-30s units for at-a-glance comparison against the
  // population reference ranges.
  const baselineWordsPer30Sec = profile.baselineSpeechRateWPM != null ? profile.baselineSpeechRateWPM / 2 : null;
  const computedWpmThreshold = profile.baselineSpeechRateWPM != null ? profile.baselineSpeechRateWPM * settings.tachylaliaMultiplier : null;

  return (
    <div className="flex w-full flex-col gap-4">
      {profile.isPersonal ? (
        <span className="mx-auto inline-flex items-center rounded-full border border-[var(--color-good)]/40 bg-[var(--color-good)]/10 backdrop-blur-xl px-2.5 py-1 text-[11px] font-medium text-[var(--color-good)]">
          Personal baseline — z-score classification
        </span>
      ) : (
        <span className="mx-auto inline-flex items-center rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 backdrop-blur-xl px-2.5 py-1 text-[11px] font-medium text-[var(--color-warning)]">
          No personal std — lower-confidence fallback
        </span>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Speech Rate" value={fmt(profile.baselineSpeechRateWPM, 0)} unit="wpm" />
        <Stat label="Articulation Rate" value={fmt(profile.baselineArticulationRate, 2)} unit="syll/s" />
        <Stat label="Pitch" value={fmt(profile.baselineMeanPitchHz, 0)} unit="Hz" />
        <Stat label="Loudness" value={fmt(profile.baselineLoudnessDb, 1)} unit="dBFS" />
        <Stat label="Pause Duration" value={fmt(profile.baselinePauseDurationSec, 2)} unit="sec" />
        <Stat label="Speech Ratio" value={formatPercent(profile.baselineSpeechRatio != null ? profile.baselineSpeechRatio * 100 : null, 0)} />
      </div>

      <div className="glass-surface-raised flex flex-col gap-2 rounded-xl px-4 py-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-ink-muted)]">Tachylalia threshold</span>
          <span className="tabular-nums font-medium text-[var(--color-critical)]">
            {fmt(profile.tachylaliaThreshold, 2)} syll/s
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-ink-muted)]">Computed WPM threshold</span>
          <span className="tabular-nums font-medium text-[var(--color-critical)]">{fmt(computedWpmThreshold, 0)} wpm</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-ink-muted)]">Words / 30s baseline</span>
          <span className="tabular-nums font-medium text-[var(--color-ink)]">{fmt(baselineWordsPer30Sec, 0)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--color-ink-muted)]">Loudness threshold</span>
          <span className="tabular-nums font-medium text-[var(--color-ink)]">~{C.LOUDNESS_ALERT_SPL_THRESHOLD} dB SPL (fixed, all patients)</span>
        </div>
      </div>

      <p className="text-center text-xs text-[var(--color-ink-muted)]">
        Calibrated from a {profile.durationSec ? Math.round(profile.durationSec) : 'N/A'}s reading
        {profile.updatedAt && ` · ${new Date(profile.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
      </p>
    </div>
  );
}
