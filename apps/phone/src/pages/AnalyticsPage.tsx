import { useNavigate } from 'react-router-dom';
import { useSessionContext } from '../context/SessionContext';
import { useCalibrationProfile } from '../hooks/useCalibrationProfile';
import { LiveTrendChart, type TrendPoint } from '../components/LiveTrendChart';
import { StatusPill } from '../components/StatusPill';
import type { MetricsFrame } from '../dsp/sessionPipeline';

function seriesFor(history: MetricsFrame[], pick: (f: MetricsFrame) => number | null): TrendPoint[] {
  return history.map((f) => ({ ts: new Date(f.ts).getTime(), value: pick(f) }));
}

/**
 * Real-time analytics: Speech Rate, Pitch, and Loudness trend charts only
 * (item 5 -- Pause and Voice Activity removed, single row so there's no
 * empty gap; both metrics are still available live on the Main screen's
 * param cards / SecondaryMetricsPanel), no ring/Start/Stop (that's the
 * Main screen's job). Reads the same session subscription as
 * LiveSessionPage via SessionContext -- no second mic/pipeline
 * subscription -- so it can be opened mid-session without interrupting
 * capture.
 */
export function AnalyticsPage() {
  const navigate = useNavigate();
  const session = useSessionContext();
  const { profile: calibration } = useCalibrationProfile();
  const isRecording = session.recordingState === 'recording';

  const history = session.history;

  return (
    <div
      className="mx-auto flex h-screen w-full max-w-3xl flex-col overflow-hidden bg-[var(--color-plane)] px-5"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <header className="flex shrink-0 items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] active:bg-[var(--color-surface-hover)]"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold text-[var(--color-ink)]">Analytics</h1>
        {isRecording ? (
          <StatusPill label="Live" color="var(--color-critical)" pulse />
        ) : (
          <span className="w-10" />
        )}
      </header>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-4">
        {!isRecording && history.length === 0 && (
          <p className="glass-surface mb-3 rounded-xl px-4 py-3 text-center text-xs text-[var(--color-ink-muted)]">
            Start a session on the Main screen to see live graphs here.
          </p>
        )}

        {/* Item 5: Speech Rate, Pitch, Loudness only -- one row, no second (previously half-empty) row */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LiveTrendChart
            title="Speech Rate"
            unit="syll/s"
            color="var(--color-rate)"
            domain={[0, 8]}
            points={seriesFor(history, (f) => f.articulationRateSPS)}
            baselineMean={calibration?.baselineArticulationRate ?? null}
            baselineStd={calibration?.baselineArticulationRateStd ?? null}
            formatValue={(v) => v.toFixed(2)}
          />
          <LiveTrendChart
            title="Pitch"
            unit="Hz"
            color="var(--color-pitch)"
            domain={[60, 320]}
            points={seriesFor(history, (f) => f.meanPitchHz)}
            baselineMean={calibration?.baselineMeanPitchHz ?? null}
            baselineStd={calibration?.baselineMeanPitchStd ?? null}
            formatValue={(v) => v.toFixed(0)}
          />
          <LiveTrendChart
            title="Loudness"
            unit="dBFS"
            color="var(--color-loudness)"
            domain={[-60, 0]}
            points={seriesFor(history, (f) => f.loudnessDb)}
            baselineMean={calibration?.baselineLoudnessDb ?? null}
            baselineStd={calibration?.baselineLoudnessStd ?? null}
            formatValue={(v) => v.toFixed(1)}
          />
        </div>
      </div>
    </div>
  );
}
