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
 * Real-time analytics: 5 live trend charts, no ring/Start/Stop (that's the
 * Main screen's job). Reads the same session subscription as
 * LiveSessionPage via SessionContext -- no second mic/pipeline
 * subscription -- so it can be opened mid-session without interrupting
 * capture. Row grouping (3 then 2) matches the old apps/dashboard live
 * panel at wide viewports; on a phone-width screen it naturally stacks to
 * one column instead of cramming 3 charts into ~380px.
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
          <p className="mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-center text-xs text-[var(--color-ink-muted)]">
            Start a session on the Main screen to see live graphs here.
          </p>
        )}

        {/* Row 1: Speech Rate, Pitch, Loudness */}
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
            domain={[-45, 0]}
            points={seriesFor(history, (f) => f.loudnessDb)}
            baselineMean={calibration?.baselineLoudnessDb ?? null}
            baselineStd={calibration?.baselineLoudnessStd ?? null}
            formatValue={(v) => v.toFixed(1)}
          />
        </div>

        {/* Row 2: Pause, Voice Activity */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <LiveTrendChart
            title="Pause"
            unit="s"
            color="var(--color-pause)"
            domain={[0, 3]}
            points={seriesFor(history, (f) => f.pauseDurationSec)}
            baselineMean={calibration?.baselinePauseDurationSec ?? null}
            baselineStd={calibration?.baselinePauseDurationStd ?? null}
            formatValue={(v) => v.toFixed(2)}
          />
          <LiveTrendChart
            title="Voice Activity"
            unit="%"
            color="var(--color-va)"
            domain={[0, 100]}
            points={seriesFor(history, (f) => f.voiceActivityPercent)}
            baselineMean={calibration?.baselineVoiceActivityPercent ?? null}
            baselineStd={calibration?.baselineVoiceActivityStd ?? null}
            formatValue={(v) => v.toFixed(0)}
          />
        </div>
      </div>
    </div>
  );
}
