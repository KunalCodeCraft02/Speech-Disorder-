import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDeviceSession } from '../hooks/useDeviceSession';
import { useClassificationFeed } from '../hooks/useClassificationFeed';
import { useCalibrationProfile } from '../hooks/useCalibrationProfile';
import { usePitchAlert } from '../hooks/usePitchAlert';
import { useDisorderMode } from '../lib/disorderMode';
import { StatusPill } from '../components/StatusPill';
import { ClassificationBadge } from '../components/ClassificationBadge';
import { DisorderModeBadge } from '../components/DisorderModeBadge';
import { PrimaryMetricsPanel } from '../components/PrimaryMetricsPanel';
import { SecondaryMetricsPanel } from '../components/SecondaryMetricsPanel';
import { Toast } from '../components/Toast';
import type { ConnectionState, RecordingState } from '../hooks/useDeviceSession';

const CONNECTION_CONFIG: Record<ConnectionState, { label: string; color: string }> = {
  connected: { label: 'Connected', color: 'var(--color-good)' },
  connecting: { label: 'Connecting…', color: 'var(--color-warning)' },
  disconnected: { label: 'Disconnected', color: 'var(--color-ink-muted)' },
  error: { label: 'Connection Error', color: 'var(--color-critical)' },
};

const RECORDING_CONFIG: Record<RecordingState, { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'Idle', color: 'var(--color-ink-muted)' },
  'requesting-permission': { label: 'Requesting Mic…', color: 'var(--color-warning)', pulse: true },
  recording: { label: 'Recording', color: 'var(--color-critical)', pulse: true },
  stopping: { label: 'Stopping…', color: 'var(--color-warning)' },
  error: { label: 'Error', color: 'var(--color-critical)' },
};

export function DevicePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { disorderMode, clearDisorderMode } = useDisorderMode();

  // Part D: Live Session requires a mode to have been chosen on the
  // landing page first.
  useEffect(() => {
    if (!disorderMode) navigate('/', { replace: true });
  }, [disorderMode, navigate]);

  const device = useDeviceSession(user?.id, disorderMode);
  const feed = useClassificationFeed(user?.id, device.sessionId);
  const calibration = useCalibrationProfile(user?.id);
  const pitchAlert = usePitchAlert(feed.latest, calibration?.baselinePitchHz);

  const [flashActive, setFlashActive] = useState(false);
  useEffect(() => {
    if (!device.visualFallbackPulse) return;
    setFlashActive(true);
    const timer = setTimeout(() => setFlashActive(false), 600);
    return () => clearTimeout(timer);
  }, [device.visualFallbackPulse]);

  const isRecording = device.recordingState === 'recording';
  const canStart = device.connectionState === 'connected' && (device.recordingState === 'idle' || device.recordingState === 'error');
  const canStop = isRecording;
  const isUncalibrated = isRecording && feed.classification === 'uncalibrated';

  const connectionCfg = CONNECTION_CONFIG[device.connectionState];
  const recordingCfg = RECORDING_CONFIG[device.recordingState];

  if (!disorderMode) return null;

  return (
    <div className={clsx('flex h-screen flex-col bg-[var(--color-plane)] px-5 py-4 transition-colors', flashActive && 'bg-[var(--color-warning)]/30')}>
      <header className="flex items-center justify-between gap-2">
        <StatusPill label={connectionCfg.label} color={connectionCfg.color} />
        <DisorderModeBadge mode={disorderMode} />
        <div className="flex items-center gap-1">
          {isRecording ? (
            <span className="px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] opacity-40">Change mode</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                clearDisorderMode();
                navigate('/');
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] active:bg-[var(--color-surface-hover)]"
            >
              Change mode
            </button>
          )}
          {isRecording ? (
            <span className="px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] opacity-40">Calibrate</span>
          ) : (
            <Link
              to="/calibrate"
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] active:bg-[var(--color-surface-hover)]"
            >
              Calibrate
            </Link>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto py-4">
        <StatusPill label={recordingCfg.label} color={recordingCfg.color} pulse={recordingCfg.pulse} />

        <ClassificationBadge classification={feed.classification} confidence={feed.confidence} active={isRecording} />

        {isUncalibrated && (
          <p className="max-w-xs text-center text-xs text-[var(--color-warning)]">
            This patient hasn't calibrated yet — tachylalia/bradylalia detection is disabled. Tap "Calibrate" above to
            set a baseline.
          </p>
        )}

        {device.errorMessage && (
          <p className="max-w-xs text-center text-sm text-[var(--color-critical)]">{device.errorMessage}</p>
        )}
        {device.micPermissionState === 'denied' && (
          <p className="max-w-xs text-center text-xs text-[var(--color-ink-muted)]">
            Microphone access was denied. Enable it in your browser's site settings, then try again.
          </p>
        )}

        {isRecording && (
          <div className="flex w-full flex-col gap-3">
            <PrimaryMetricsPanel frame={feed.latest} />
            <SecondaryMetricsPanel frame={feed.latest} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 pb-2">
        <button
          type="button"
          onClick={() => void device.startRecording()}
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
          onClick={device.stopRecording}
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
