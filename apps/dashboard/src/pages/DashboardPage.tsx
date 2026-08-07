import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLiveSession } from '../hooks/useLiveSession';
import { useActiveSession, useCalibration, useSessionMetricsHistory } from '../hooks/useSessionQueries';
import { useMergedSeries } from '../hooks/useMergedSeries';
import { Card } from '../components/common/Card';
import { CollapsibleCard } from '../components/common/CollapsibleCard';
import { EmptyState } from '../components/common/EmptyState';
import { LiveGaugesPanel } from '../components/gauges/LiveGaugesPanel';
import { PrimaryCountersPanel } from '../components/gauges/PrimaryCountersPanel';
import { SecondaryMetricsPanel } from '../components/gauges/SecondaryMetricsPanel';
import { WaveformPanel } from '../components/waveform/WaveformPanel';
import { ClassificationBadge } from '../components/status/ClassificationBadge';
import { SessionTimer } from '../components/status/SessionTimer';
import { DisorderModeBadge } from '../components/status/DisorderModeBadge';
import { SpeechRateChart } from '../components/charts/SpeechRateChart';
import { PitchChart } from '../components/charts/PitchChart';
import { LoudnessChart } from '../components/charts/LoudnessChart';
import { PauseChart } from '../components/charts/PauseChart';
import { VoiceActivityChart } from '../components/charts/VoiceActivityChart';
import { HistoryTable } from '../components/history/HistoryTable';
import { CalibrationSummaryCard } from '../components/calibration/CalibrationSummaryCard';
import { ConnectionLogPanel } from '../components/diagnostics/ConnectionLogPanel';
import type { ConnectionState } from '../hooks/useLiveSession';

export function DashboardPage({
  onConnectionChange,
  onResetReady,
}: {
  onConnectionChange: (state: ConnectionState) => void;
  onResetReady: (reset: () => void) => void;
}) {
  const { user } = useAuth();
  const { data: activeSession, isLoading: activeSessionLoading } = useActiveSession(user?.id);
  const sessionId = activeSession?._id ?? null;

  const live = useLiveSession(user?.id, sessionId);

  useEffect(() => {
    onConnectionChange(live.connectionState);
  }, [live.connectionState, onConnectionChange]);

  useEffect(() => {
    onResetReady(live.reset);
  }, [live.reset, onResetReady]);

  const { data: backfill } = useSessionMetricsHistory(sessionId ?? undefined);
  const { data: calibration } = useCalibration(user?.id);
  const series = useMergedSeries(backfill, live.history);

  const noActiveSession = !activeSessionLoading && !sessionId;
  const isUncalibrated = !calibration || calibration.baselineArticulationRate == null;
  const isLowerConfidence = !isUncalibrated && calibration?.isPersonal === false;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4 md:p-6">
      {noActiveSession && (
        <Card className="border-[var(--color-warning)]/30">
          <EmptyState
            title="No active session"
            hint="Start a session from the patient device to see it appear here in real time. Session history is below."
          />
        </Card>
      )}

      {isUncalibrated && (
        <Card className="border-[var(--color-warning)]/30">
          <EmptyState
            title="Patient not calibrated"
            hint='This patient has no baseline yet — tachylalia/bradylalia detection is disabled until calibration runs on the phone app (the "Calibrate" link on the device screen). Sessions will show "Uncalibrated" instead of a classification.'
          />
        </Card>
      )}
      {isLowerConfidence && (
        <Card className="border-[var(--color-warning)]/30">
          <EmptyState
            title="Lower-confidence baseline"
            hint="This session is running on a population-default baseline rather than the patient's own calibrated variance — classification confidence is reduced until a full audio calibration is completed."
          />
        </Card>
      )}

      {/* Connection log: real-time trail of phone <-> gateway <-> dashboard link */}
      <Card
        title="Connection Activity"
        subtitle="Live trail of the phone/gateway/dashboard link — useful while verifying a new device connects"
      >
        <ConnectionLogPanel entries={live.connectionLog} />
      </Card>

      {/* Session status row: timer, classification, disorder mode */}
      <div id="live-session-section" className="flex scroll-mt-4 flex-col gap-4">
        <div className="flex items-center gap-2">
          <DisorderModeBadge mode={live.disorderMode} />
          {isUncalibrated ? (
            <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1 text-xs font-medium text-[var(--color-ink-muted)]">
              Not calibrated
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-good)]/40 bg-[var(--color-good)]/10 px-3 py-1 text-xs font-medium text-[var(--color-good)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-good)]" />
              Calibrated · {calibration!.baselineArticulationRate!.toFixed(2)} syll/s
            </span>
          )}
          {live.demoMode && (
            <span className="inline-flex items-center rounded-full border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-1 text-xs font-medium text-[var(--color-warning)]">
              Demo mode
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card title="Session Timer">
            <div className="flex h-full items-center justify-center">
              <SessionTimer startedAt={activeSession?.startedAt ?? null} elapsedSec={live.latest?.elapsedSec ?? null} />
            </div>
          </Card>
          <Card title="Current Classification">
            <ClassificationBadge classification={live.latest?.classification ?? null} confidence={live.latest?.confidence ?? null} />
          </Card>
        </div>
      </div>

      {/* Primary parameters (Part F) -- always visible */}
      <Card title="Words &amp; Syllables" subtitle="Independent 30s trailing window + session-cumulative counters">
        <PrimaryCountersPanel frame={live.latest} />
      </Card>

      {/* Live gauges */}
      <Card title="Live Gauges" subtitle="Instantaneous values from the current analysis window">
        <LiveGaugesPanel frame={live.latest} calibration={calibration} />
      </Card>

      {/* Waveform */}
      <Card title="Voice Activity Waveform" subtitle="Live loudness / voicing envelope">
        <WaveformPanel frame={live.latest} connected={live.connectionState === 'connected'} />
      </Card>

      {/* Trend charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title="Speech Rate" subtitle="Articulation rate (syllables/sec)">
          <SpeechRateChart data={series} calibration={calibration} />
        </Card>
        <Card title="Pitch" subtitle="Mean fundamental frequency">
          <PitchChart data={series} />
        </Card>
        <Card title="Loudness" subtitle="Perceived loudness (dB)">
          <LoudnessChart data={series} />
        </Card>
        <Card title="Pause" subtitle="Pause ratio of total speaking time">
          <PauseChart data={series} />
        </Card>
        <Card title="Voice Activity" subtitle="Percent of window classified as voiced">
          <VoiceActivityChart data={series} />
        </Card>
      </div>

      {/* Secondary parameters (Part F) -- collapsed by default */}
      <CollapsibleCard id="secondary-metrics-section" title="Detailed Metrics" subtitle="Decision audit, prosody, and disfluency parameters">
        <SecondaryMetricsPanel frame={live.latest} />
      </CollapsibleCard>

      {/* History + Calibration */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card id="history-section" title="Session History" className="xl:col-span-2 scroll-mt-4">
          <HistoryTable />
        </Card>
        <Card id="calibration-section" title="Calibration Summary" subtitle="Patient baseline thresholds" className="scroll-mt-4">
          <CalibrationSummaryCard userId={user?.id} />
        </Card>
      </div>
    </div>
  );
}
