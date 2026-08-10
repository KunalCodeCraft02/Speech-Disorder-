import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { useLiveSession } from '../hooks/useLiveSession';
import { useCalibrationProfile } from '../hooks/useCalibrationProfile';
import { usePitchAlert } from '../hooks/usePitchAlert';
import { StatusPill } from '../components/StatusPill';
import { ClassificationBadge } from '../components/ClassificationBadge';
import { PrimaryMetricsPanel } from '../components/PrimaryMetricsPanel';
import { SecondaryMetricsPanel } from '../components/SecondaryMetricsPanel';
import { Toast } from '../components/Toast';
import { MicErrorMessage } from '../components/MicErrorMessage';
import type { RecordingState } from '../hooks/useLiveSession';

const RECORDING_CONFIG: Record<RecordingState, { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'Idle', color: 'var(--color-ink-muted)' },
  'requesting-permission': { label: 'Requesting Mic…', color: 'var(--color-warning)', pulse: true },
  recording: { label: 'Recording', color: 'var(--color-critical)', pulse: true },
  stopping: { label: 'Stopping…', color: 'var(--color-warning)' },
  error: { label: 'Error', color: 'var(--color-critical)' },
};

/**
 * Single live-session screen: everything runs in this tab, on-device — no
 * gateway, no dashboard route. Classification ring + the full primary
 * parameter set + expandable detail panel are all shown together (merges
 * what used to be the separate phone minimal view and dashboard live
 * panel).
 */
export function LiveSessionPage() {
  const session = useLiveSession();
  const { profile: calibration } = useCalibrationProfile();
  const pitchAlert = usePitchAlert(session.latest, calibration?.baselinePitchHz);

  const [flashActive, setFlashActive] = useState(false);
  useEffect(() => {
    if (session.visualFallbackPulse === 0) return;
    setFlashActive(true);
    const timer = setTimeout(() => setFlashActive(false), 600);
    return () => clearTimeout(timer);
  }, [session.visualFallbackPulse]);

  const isRecording = session.recordingState === 'recording';
  const canStart = session.recordingState === 'idle' || session.recordingState === 'error';
  const canStop = isRecording;
  const isUncalibrated = isRecording && session.classification === 'uncalibrated';

  const recordingCfg = RECORDING_CONFIG[session.recordingState];

  return (
    <div className={clsx('flex h-screen flex-col bg-[var(--color-plane)] px-5 py-4 transition-colors', flashActive && 'bg-[var(--color-warning)]/30')}>
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-sm font-semibold text-[var(--color-ink)]">Speech Biofeedback</h1>
        <div className="flex items-center gap-2">
          {isRecording ? (
            <span className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] opacity-40">Today</span>
          ) : (
            <Link
              to="/today"
              className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-secondary)] active:bg-[var(--color-surface-hover)]"
            >
              Today
            </Link>
          )}
          {isRecording ? (
            <span className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] opacity-40">Calibrate</span>
          ) : (
            <Link
              to="/calibrate"
              className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)] active:bg-[var(--color-accent)]/20"
            >
              Calibrate
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto py-4">
        {!isRecording && calibration === null && (
          <Link
            to="/calibrate"
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/8 px-4 py-3 active:bg-[var(--color-accent)]/15"
          >
            <span className="text-sm text-[var(--color-ink)]">
              <span className="font-semibold">Set up your baseline</span> — calibrate your voice to enable detection
            </span>
            <span className="text-lg text-[var(--color-accent)]">→</span>
          </Link>
        )}

        <StatusPill label={recordingCfg.label} color={recordingCfg.color} pulse={recordingCfg.pulse} />

        <ClassificationBadge classification={session.classification} confidence={session.confidence} active={isRecording} />

        {isUncalibrated && (
          <p className="max-w-xs text-center text-xs text-[var(--color-warning)]">
            You haven't calibrated yet — tachylalia detection is disabled. Tap "Calibrate" above to set a baseline.
          </p>
        )}

        {session.errorMessage && <MicErrorMessage message={session.errorMessage} />}
        {session.micPermissionState === 'denied' && (
          <p className="max-w-xs text-center text-xs text-[var(--color-ink-muted)]">
            Microphone access was denied. Enable it in your browser's site settings, then try again.
          </p>
        )}

        {isRecording && (
          <div className="flex w-full flex-col gap-3">
            <PrimaryMetricsPanel frame={session.latest} />
            <SecondaryMetricsPanel frame={session.latest} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 pb-2">
        <button
          type="button"
          onClick={() => void session.startRecording()}
          disabled={!canStart}
          className={clsx(
            'w-full rounded-2xl py-6 text-xl font-bold tracking-wide text-white transition-all active:scale-[0.98]',
            canStart ? 'bg-[var(--color-good)] shadow-lg shadow-[var(--color-good)]/20' : 'bg-[var(--color-surface-raised)] text-[var(--color-ink-muted)]'
          )}
        >
          Start
        </button>
        <button
          type="button"
          onClick={session.stopRecording}
          disabled={!canStop}
          className={clsx(
            'w-full rounded-2xl py-6 text-xl font-bold tracking-wide text-white transition-all active:scale-[0.98]',
            canStop ? 'bg-[var(--color-critical)] shadow-lg shadow-[var(--color-critical)]/20' : 'bg-[var(--color-surface-raised)] text-[var(--color-ink-muted)]'
          )}
        >
          Stop
        </button>
      </div>

      <Toast message={pitchAlert.toastMessage} onDismiss={pitchAlert.dismiss} />
    </div>
  );
}
