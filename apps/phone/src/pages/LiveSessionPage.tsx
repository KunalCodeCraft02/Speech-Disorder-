import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { useSessionContext } from '../context/SessionContext';
import { useCalibrationProfile } from '../hooks/useCalibrationProfile';
import { usePitchAlert } from '../hooks/usePitchAlert';
import { StatusPill } from '../components/StatusPill';
import { ClassificationBadge } from '../components/ClassificationBadge';
import { ParamGrid } from '../components/ParamGrid';
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

function NavPill({ to, label, disabled, accent }: { to: string; label: string; disabled: boolean; accent?: boolean }) {
  if (disabled) {
    return <span className="glass-surface-raised rounded-full px-3 py-1.5 text-xs font-medium text-[var(--color-ink-muted)] opacity-40">{label}</span>;
  }
  return (
    <Link
      to={to}
      className={clsx(
        'rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-xl active:scale-[0.97]',
        accent
          ? 'border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 text-[var(--color-accent-2)]'
          : 'glass-surface text-[var(--color-ink-secondary)] active:bg-[var(--color-surface-hover)]'
      )}
    >
      {label}
    </Link>
  );
}

/**
 * Main screen: classification ring + confidence, the 10 param cards, and
 * Start/Stop -- no charts here (those live in the Analytics tab, which
 * reads the same shared session subscription via SessionContext so
 * switching tabs mid-recording doesn't restart capture).
 */
export function LiveSessionPage() {
  const session = useSessionContext();
  const { profile: calibration } = useCalibrationProfile();
  const pitchAlert = usePitchAlert(session.latest);

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
  const calibrated = calibration != null;

  const recordingCfg = RECORDING_CONFIG[session.recordingState];

  return (
    <div
      className={clsx(
        'mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[var(--color-plane)] px-5 transition-colors',
        flashActive && 'bg-[var(--color-warning)]/20'
      )}
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="bg-gradient-to-r from-[var(--color-ink)] to-[var(--color-accent-2)] bg-clip-text text-sm font-semibold text-transparent">
          Speech Biofeedback
        </h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <NavPill to="/analytics" label="Analytics" disabled={false} accent />
          <NavPill to="/today" label="Today" disabled={isRecording} />
          <NavPill to="/calibrate" label="Calibrate" disabled={isRecording} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col items-center gap-4 py-4 pb-2">
          {!isRecording && calibration === null && (
            <Link
              to="/calibrate"
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-4 py-3 backdrop-blur-xl active:bg-[var(--color-accent)]/20"
            >
              <span className="text-sm text-[var(--color-ink)]">
                <span className="font-semibold">Set up your baseline</span> — calibrate your voice to enable detection
              </span>
              <span className="text-lg text-[var(--color-accent-2)]">→</span>
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
              <ParamGrid frame={session.latest} calibrated={calibrated} />
              <SecondaryMetricsPanel frame={session.latest} />
            </div>
          )}
        </div>
      </div>

      <div className="relative flex flex-col gap-3 pt-2">
        <span aria-hidden="true" className="glass-blob left-[8%] h-24 w-24 bg-[var(--color-good)]/30" style={{ bottom: '4.5rem' }} />
        <span aria-hidden="true" className="glass-blob right-[10%] h-28 w-28 bg-[var(--color-critical)]/25" style={{ bottom: '-0.5rem' }} />

        <button
          type="button"
          onClick={() => void session.startRecording()}
          disabled={!canStart}
          className={clsx(
            'w-full rounded-2xl py-6 text-xl font-bold tracking-wide transition-all active:scale-[0.98]',
            canStart ? 'glass-btn glass-btn-start text-white' : 'glass-btn glass-btn-disabled'
          )}
        >
          Start
        </button>
        <button
          type="button"
          onClick={session.stopRecording}
          disabled={!canStop}
          className={clsx(
            'w-full rounded-2xl py-6 text-xl font-bold tracking-wide transition-all active:scale-[0.98]',
            canStop ? 'glass-btn glass-btn-stop text-white' : 'glass-btn glass-btn-disabled'
          )}
        >
          Stop
        </button>
      </div>

      <Toast message={pitchAlert.toastMessage} onDismiss={pitchAlert.dismiss} />
    </div>
  );
}
