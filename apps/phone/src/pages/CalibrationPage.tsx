import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useCalibrationRecorder } from '../hooks/useCalibrationRecorder';
import { dataClient } from '../lib/dataClient';
import { extractApiErrorMessage } from '../lib/api';
import { CALIBRATION_CLIP_DURATION_SEC, CALIBRATION_PASSAGES } from '../lib/calibrationPassage';
import { CalibrationSummary } from '../components/CalibrationSummary';
import type { CalibrationClipUpload, CalibrationProfile } from '../types';

type Phase = 'intro' | 'capturing' | 'submitting' | 'summary' | 'error';

const CLIP_COUNT = CALIBRATION_PASSAGES.length;

// The backend doesn't report granular calibration progress -- it's a single
// synchronous POST that runs per-clip sub-window analysis and then pools the
// final baseline server-side. This estimates progress client-side from
// elapsed time against a rough expected duration, easing toward 92% so it
// never falsely claims "done" before the response actually arrives, then
// creeping slowly if processing runs long.
const ESTIMATED_SUBMIT_MS = 3000;
const ANALYZING_LABEL_CUTOFF_PCT = 65; // switch from "Analyzing…" to "Computing baseline…" past this point

function useSubmitProgress(active: boolean) {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!active) {
      setPercent(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = elapsed / ESTIMATED_SUBMIT_MS;
      const pct = ratio < 1 ? 92 * (1 - (1 - ratio) ** 2) : Math.min(97, 92 + (elapsed - ESTIMATED_SUBMIT_MS) / 400);
      setPercent(pct);
    }, 100);
    return () => clearInterval(interval);
  }, [active]);

  return percent;
}

function Spinner() {
  return (
    <svg className="h-6 w-6 animate-spin text-[var(--color-accent)]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}

/**
 * Part A.2/A.3/A.4: records CLIP_COUNT (2) independent ~20s clips back to
 * back and pools them into one calibration request — two short clips beat
 * one longer one for estimating the patient's own variance, and a clip
 * with too little actual speech gets rejected server-side (dsp-service's
 * MIN_CALIBRATION_PHONATION_SEC), surfaced here as an error the patient
 * can retry from scratch via "Try Again".
 */
export function CalibrationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const recorder = useCalibrationRecorder(CALIBRATION_CLIP_DURATION_SEC);

  const [phase, setPhase] = useState<Phase>('intro');
  const [clipIndex, setClipIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationProfile | null>(null);
  const [submitDone, setSubmitDone] = useState(false);
  const estimatedProgress = useSubmitProgress(phase === 'submitting' && !submitDone);
  const submitProgress = submitDone ? 100 : estimatedProgress;

  async function handleStart() {
    if (!user) return;
    setSubmitError(null);
    setPhase('capturing');

    const clips: CalibrationClipUpload[] = [];
    try {
      for (let i = 0; i < CLIP_COUNT; i++) {
        setClipIndex(i);
        const recording = await recorder.record();
        clips.push({ audioBase64: recording.audioBase64, sampleRate: recording.sampleRate });
      }
    } catch (err) {
      if (!recorder.isCancelled(err)) setPhase('error');
      else setPhase('intro');
      return;
    }

    setSubmitDone(false);
    setPhase('submitting');
    try {
      const profile = await dataClient.recordCalibration(user.id, clips);
      setResult(profile);
      setSubmitDone(true);
      // Let the 100% state render for a beat instead of jumping straight
      // from mid-progress to the summary screen.
      await new Promise((resolve) => setTimeout(resolve, 250));
      setPhase('summary');
    } catch (err) {
      setSubmitError(extractApiErrorMessage(err, 'Failed to process calibration'));
      setPhase('error');
    }
  }

  const progress = 1 - recorder.secondsRemaining / CALIBRATION_CLIP_DURATION_SEC;
  const passage = CALIBRATION_PASSAGES[clipIndex] ?? CALIBRATION_PASSAGES[0];

  return (
    <div className="flex h-screen flex-col bg-[var(--color-plane)] px-5 py-4">
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/session')}
          disabled={phase === 'submitting'}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] active:bg-[var(--color-surface-hover)] disabled:opacity-30"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold text-[var(--color-ink)]">Voice Calibration</h1>
        <span className="w-10" />
      </header>

      {phase === 'summary' && result ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto py-4">
          <p className="text-sm font-medium text-[var(--color-good)]">Calibration complete</p>
          <CalibrationSummary profile={result} />
          <button
            type="button"
            onClick={() => navigate('/session')}
            className="w-full rounded-2xl bg-[var(--color-accent)] py-4 text-lg font-bold text-white active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex-1 overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
              {phase === 'capturing' ? `Clip ${clipIndex + 1} of ${CLIP_COUNT}` : `${CLIP_COUNT} short readings, ~${CALIBRATION_CLIP_DURATION_SEC}s each`}
              {' — read aloud, at your normal pace'}
            </p>
            <p className="whitespace-pre-line text-lg leading-relaxed text-[var(--color-ink)]">{passage}</p>
          </div>

          <div className="flex flex-col items-center gap-3 py-4">
            {phase === 'capturing' && (
              <div className="flex w-full flex-col items-center gap-2">
                <div className="flex w-full gap-1">
                  {Array.from({ length: CLIP_COUNT }, (_, i) => (
                    <div key={i} className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-accent)] transition-all duration-1000 ease-linear"
                        style={{ width: `${i < clipIndex ? 100 : i === clipIndex ? Math.min(100, progress * 100) : 0}%` }}
                      />
                    </div>
                  ))}
                </div>
                <p className="tabular-nums text-2xl font-bold text-[var(--color-ink)]">
                  {recorder.state === 'requesting-permission' ? 'Requesting mic…' : `${recorder.secondsRemaining}s`}
                </p>
              </div>
            )}

            {phase === 'submitting' && (
              <div className="flex w-full flex-col items-center gap-3">
                <Spinner />
                <p className="text-sm text-[var(--color-ink-secondary)]">
                  {submitProgress < ANALYZING_LABEL_CUTOFF_PCT ? 'Analyzing your readings…' : 'Computing your baseline…'}
                </p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-150 ease-linear"
                    style={{ width: `${submitProgress}%` }}
                  />
                </div>
                <p className="tabular-nums text-lg font-bold text-[var(--color-ink)]">{Math.round(submitProgress)}%</p>
              </div>
            )}

            {phase === 'error' && (
              <p className="max-w-xs text-center text-sm text-[var(--color-critical)]">
                {submitError ?? recorder.error ?? 'Something went wrong'}
              </p>
            )}

            {(phase === 'intro' || phase === 'error') && (
              <button
                type="button"
                onClick={() => void handleStart()}
                className="w-full rounded-2xl bg-[var(--color-accent)] py-5 text-xl font-bold text-white active:scale-[0.98]"
              >
                {phase === 'error' ? 'Try Again' : 'Start Reading'}
              </button>
            )}

            {phase === 'capturing' && (
              <button
                type="button"
                onClick={recorder.cancel}
                className={clsx(
                  'w-full rounded-2xl py-4 text-base font-semibold text-[var(--color-ink-secondary)] active:scale-[0.98]',
                  'bg-[var(--color-surface-raised)]'
                )}
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
