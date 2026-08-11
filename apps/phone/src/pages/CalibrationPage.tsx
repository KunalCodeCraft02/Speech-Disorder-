import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalibrationRecorder } from '../hooks/useCalibrationRecorder';
import { useCalibrationProfile } from '../hooks/useCalibrationProfile';
import { useCurrentUser } from '../context/CurrentUserContext';
import { runCalibration, CalibrationError } from '../lib/calibrationEngine';
import { CALIBRATION_CLIP_DURATION_SEC, CALIBRATION_PASSAGES } from '../lib/calibrationPassage';
import { CalibrationSummary } from '../components/CalibrationSummary';
import { MicErrorMessage } from '../components/MicErrorMessage';
import type { CalibrationRecord } from '../storage/calibration';

type Phase = 'loading' | 'view' | 'intro' | 'capturing' | 'submitting' | 'summary' | 'error';

const CLIP_COUNT = CALIBRATION_PASSAGES.length;

// Local analysis of ~40s of audio is fast (well under a second in
// practice) but still takes a perceptible beat — this estimates progress
// client-side from elapsed time so the bar doesn't just jump from 0 to
// 100%, easing toward 92% so it never falsely claims "done" before
// analysis actually finishes.
const ESTIMATED_SUBMIT_MS = 1200;
const ANALYZING_LABEL_CUTOFF_PCT = 65;

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
 * Records CLIP_COUNT (2) independent ~20s clips back to back and pools
 * them into one local calibration pass — two short clips beat one longer
 * one for estimating the patient's own variance. A clip pool with too
 * little actual speech is rejected (mirrors the DSP service's old
 * MIN_CALIBRATION_PHONATION_SEC gate, now enforced locally), surfaced here
 * as an error the patient can retry from scratch via "Try Again".
 * Everything — recording, analysis, storage — happens on-device, scoped to
 * the signed-in user (see storage/calibration.ts).
 *
 * If this user already has a saved calibration, opening this screen shows
 * it (phase 'view') instead of immediately starting a new recording --
 * only tapping "Update Calibration" enters the same capture/submit flow a
 * first-time user gets from 'intro'. Nothing is written to storage until
 * that flow succeeds, so cancelling or a failed attempt during an update
 * leaves the existing calibration exactly as it was.
 */
export function CalibrationPage() {
  const navigate = useNavigate();
  const { userId } = useCurrentUser();
  const { profile: existingProfile } = useCalibrationProfile();
  const recorder = useCalibrationRecorder(CALIBRATION_CLIP_DURATION_SEC);

  const [phase, setPhase] = useState<Phase>('loading');
  const [clipIndex, setClipIndex] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrationRecord | null>(null);
  const [submitDone, setSubmitDone] = useState(false);
  const estimatedProgress = useSubmitProgress(phase === 'submitting' && !submitDone);
  const submitProgress = submitDone ? 100 : estimatedProgress;

  // Whether this attempt started from "Update Calibration" (an existing
  // calibration to fall back to) vs. first-time "Start Reading" (none yet)
  // -- decides where Cancel/error sends the user back to.
  const isUpdateRef = useRef(false);

  useEffect(() => {
    if (existingProfile === undefined) {
      setPhase('loading');
      return;
    }
    setPhase((prev) => (prev === 'loading' ? (existingProfile ? 'view' : 'intro') : prev));
  }, [existingProfile]);

  async function handleStart() {
    setSubmitError(null);
    setPhase('capturing');

    const clips: Array<{ samples: Float32Array; sampleRate: number }> = [];
    try {
      for (let i = 0; i < CLIP_COUNT; i++) {
        setClipIndex(i);
        const recording = await recorder.record();
        clips.push({ samples: recording.samples, sampleRate: recording.sampleRate });
      }
    } catch (err) {
      if (!recorder.isCancelled(err)) setPhase('error');
      else setPhase(isUpdateRef.current ? 'view' : 'intro');
      return;
    }

    setSubmitDone(false);
    setPhase('submitting');
    try {
      const record = await runCalibration(userId, clips);
      setResult(record);
      setSubmitDone(true);
      // Let the 100% state render for a beat instead of jumping straight
      // from mid-progress to the summary screen.
      await new Promise((resolve) => setTimeout(resolve, 250));
      setPhase('summary');
    } catch (err) {
      setSubmitError(err instanceof CalibrationError ? err.message : 'Failed to process calibration');
      setPhase('error');
    }
  }

  function startUpdate() {
    isUpdateRef.current = true;
    void handleStart();
  }

  const progress = 1 - recorder.secondsRemaining / CALIBRATION_CLIP_DURATION_SEC;
  const passage = CALIBRATION_PASSAGES[clipIndex] ?? CALIBRATION_PASSAGES[0];

  return (
    <div
      className="mx-auto flex h-screen w-full max-w-md flex-col overflow-hidden bg-[var(--color-plane)] px-5"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <header className="flex shrink-0 items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/')}
          disabled={phase === 'submitting'}
          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] active:bg-[var(--color-surface-hover)] disabled:opacity-30"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold text-[var(--color-ink)]">Voice Calibration</h1>
        <span className="w-10" />
      </header>

      {phase === 'loading' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-[var(--color-ink-muted)]">
          <Spinner />
          Loading your calibration…
        </div>
      )}

      {phase === 'view' && existingProfile && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center gap-5 py-4">
            <span className="glass-surface-raised inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--color-good)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-good)]" />
              Current Calibration
            </span>
            <CalibrationSummary profile={existingProfile} />
            <button
              type="button"
              onClick={startUpdate}
              className="glass-btn glass-btn-accent w-full rounded-2xl py-4 text-lg font-bold text-white active:scale-[0.98]"
            >
              Update Calibration
            </button>
          </div>
        </div>
      )}

      {phase === 'summary' && result && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center gap-5 py-4">
            <p className="text-sm font-medium text-[var(--color-good)]">Calibration complete</p>
            <CalibrationSummary profile={result} />
            <button
              type="button"
              onClick={() => navigate('/')}
              className="glass-btn glass-btn-accent w-full rounded-2xl py-4 text-lg font-bold text-white active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {(phase === 'intro' || phase === 'capturing' || phase === 'submitting' || phase === 'error') && (
        <>
          <div className="glass-surface mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl p-5">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]">
              {phase === 'capturing' ? `Clip ${clipIndex + 1} of ${CLIP_COUNT}` : `${CLIP_COUNT} short readings, ~${CALIBRATION_CLIP_DURATION_SEC}s each`}
              {' — read aloud, at your normal pace'}
            </p>
            <p className="whitespace-pre-line text-lg leading-relaxed text-[var(--color-ink)]">{passage}</p>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-3 py-4">
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

            {phase === 'error' && <MicErrorMessage message={submitError ?? recorder.error ?? 'Something went wrong'} />}

            {(phase === 'intro' || phase === 'error') && (
              <button
                type="button"
                onClick={() => void handleStart()}
                className="glass-btn glass-btn-accent w-full rounded-2xl py-5 text-xl font-bold text-white active:scale-[0.98]"
              >
                {phase === 'error' ? 'Try Again' : 'Start Reading'}
              </button>
            )}

            {phase === 'error' && isUpdateRef.current && existingProfile && (
              <button
                type="button"
                onClick={() => setPhase('view')}
                className="glass-surface-raised w-full rounded-2xl py-4 text-base font-semibold text-[var(--color-ink-secondary)] active:scale-[0.98]"
              >
                Keep Current Calibration
              </button>
            )}

            {phase === 'intro' && (
              <p className="text-center text-xs text-[var(--color-ink-muted)]">First time calibrating — this sets your personal baseline.</p>
            )}

            {phase === 'capturing' && (
              <button
                type="button"
                onClick={recorder.cancel}
                className="glass-surface-raised w-full rounded-2xl py-4 text-base font-semibold text-[var(--color-ink-secondary)] active:scale-[0.98]"
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
