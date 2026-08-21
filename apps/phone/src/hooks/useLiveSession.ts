import { useCallback, useEffect, useRef, useState } from 'react';
import { baselineFromStored } from '../dsp/baseline';
import { settings } from '../dsp/config';
import { SessionPipeline, type MetricsFrame } from '../dsp/sessionPipeline';
import { playBeep } from '../lib/beep';
import { mainAlertHaptic } from '../lib/haptics';
import { describeMicErrorVerbose } from '../lib/micStream';
import { getCalibration } from '../storage/calibration';
import { dateKeyFor, saveSession, type SessionSummary } from '../storage/sessions';
import { useCurrentUser } from '../context/CurrentUserContext';
import { useHeadsetAudioContext } from '../context/HeadsetAudioContext';
import { useAudioCapture } from './useAudioCapture';

export type RecordingState = 'idle' | 'requesting-permission' | 'recording' | 'stopping' | 'error';

function newSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owns the entire live session: mic capture -> local SessionPipeline ->
 * classification -> vibration feedback, all in-process in this tab. No
 * socket, no server — everything that used to be gateway/DSP-service
 * round-trips now happens on-device, so this works with no network
 * connection once the app (and its calibration) has loaded once.
 */
export function useLiveSession() {
  const { userId } = useCurrentUser();
  const headset = useHeadsetAudioContext();
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [latest, setLatest] = useState<MetricsFrame | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [visualFallbackPulse, setVisualFallbackPulse] = useState<number>(0);
  const [uncalibrated, setUncalibrated] = useState<boolean | null>(null);

  const pipelineRef = useRef<SessionPipeline | null>(null);
  const sessionStartedAtRef = useRef<string | null>(null);
  const lastElapsedRef = useRef(0);
  const tachylaliaAccumSecRef = useRef(0);
  const feedbackCountRef = useRef(0);
  const rateAccumRef = useRef({ sum: 0, count: 0 });
  const baselineRateRef = useRef<number | null>(null);

  const handleChunk = useCallback((samples: Float32Array) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;

    const frame = pipeline.processChunk(samples);
    if (!frame) return;

    const dt = Math.max(0, frame.elapsedSec - lastElapsedRef.current);
    if (frame.classification === 'tachylalia') tachylaliaAccumSecRef.current += dt;
    lastElapsedRef.current = frame.elapsedSec;

    rateAccumRef.current.sum += frame.articulationRateSPS;
    rateAccumRef.current.count += 1;

    if (frame.triggerFeedback) {
      feedbackCountRef.current += 1;
      void mainAlertHaptic().then((fired) => {
        if (!fired) {
          playBeep();
          setVisualFallbackPulse((n) => n + 1);
        }
      });
    }

    setLatest(frame);
  }, []);

  const capture = useAudioCapture({ onChunk: handleChunk });

  const startRecording = useCallback(async () => {
    if (recordingState === 'recording' || recordingState === 'requesting-permission') return;
    // Defense-in-depth: the Start button is unreachable while the
    // headset gate (App.tsx's HeadsetGate) is blocking the routes, but
    // guard here too in case a stale render slips through.
    if (!headset.connected) return;

    setErrorMessage(null);
    setRecordingState('requesting-permission');

    // capture.start() creates the AudioContext "as the very first thing"
    // specifically to stay tied to this click's user-activation call stack
    // (see useAudioCapture's comment) — so it must be kicked off here
    // before any other `await`, not after one. Awaiting getCalibration()
    // (IndexedDB) first would insert a microtask boundary ahead of it,
    // breaking that gesture linkage and making AudioWorkletNode
    // construction fail with "No execution context available".
    const capturePromise = capture.start();
    const calibrationPromise = getCalibration(userId);

    try {
      await capturePromise;
    } catch (err) {
      setErrorMessage(describeMicErrorVerbose(err));
      setRecordingState('error');
      return;
    }

    const calibration = await calibrationPromise;
    const baseline = baselineFromStored(calibration, settings);
    setUncalibrated(baseline === null);
    baselineRateRef.current = baseline?.baselineArticulationRate ?? null;

    pipelineRef.current = new SessionPipeline(newSessionId(), baseline, settings);
    sessionStartedAtRef.current = new Date().toISOString();
    lastElapsedRef.current = 0;
    tachylaliaAccumSecRef.current = 0;
    feedbackCountRef.current = 0;
    rateAccumRef.current = { sum: 0, count: 0 };
    setLatest(null);
    setRecordingState('recording');
  }, [headset.connected, capture, recordingState, userId]);

  const stopRecording = useCallback(() => {
    if (recordingState !== 'recording') return;
    setRecordingState('stopping');
    capture.stop();

    const pipeline = pipelineRef.current;
    if (pipeline) {
      const durationSec = pipeline.elapsedSec;
      const startedAt = sessionStartedAtRef.current ?? new Date().toISOString();
      // Final aggregate stats, computed once from the complete accumulated
      // session state (not a snapshot of the last live frame) -- see
      // SessionPipeline.buildSummary()'s doc comment.
      const finalSummary = pipeline.buildSummary();
      const summary: SessionSummary = {
        id: pipeline.sessionId,
        dateKey: dateKeyFor(new Date(startedAt)),
        startedAt,
        endedAt: new Date().toISOString(),
        durationSec,
        avgArticulationRateSPS: rateAccumRef.current.count > 0 ? rateAccumRef.current.sum / rateAccumRef.current.count : null,
        timeInTachylaliaSec: tachylaliaAccumSecRef.current,
        feedbackTriggerCount: feedbackCountRef.current,
        baselineArticulationRateAtSession: baselineRateRef.current,
        finalVoiceActivityPercent: finalSummary.finalMetrics.voiceActivityPercent,
        finalCompositeScore: finalSummary.finalMetrics.compositeScore,
        totalSyllables: finalSummary.totalSyllables,
        totalPauses: finalSummary.totalPauses,
      };
      // Fire-and-forget: a slow IndexedDB write must not block the UI from
      // returning to idle.
      if (durationSec > 0) void saveSession(summary);
    }

    pipelineRef.current = null;
    sessionStartedAtRef.current = null;
    setRecordingState('idle');
  }, [capture, recordingState]);

  // Part J: the headset disconnecting mid-session must stop the session
  // immediately, not just block the *next* Start -- App.tsx's HeadsetGate
  // re-shows the connect prompt on the same `connected` flag once this
  // fires, so the two together satisfy "stop the session and re-show the
  // connect prompt."
  useEffect(() => {
    if (!headset.connected && recordingState === 'recording') stopRecording();
  }, [headset.connected, recordingState, stopRecording]);

  // `capture` (useAudioCapture's return value) is a new object every
  // render, but `capture.stop` itself is a stable useCallback. Depending
  // on the whole object here made React treat every re-render as a
  // dependency change and run this cleanup mid-session — closing the
  // AudioContext capture.start() had just created, out from under its
  // still-in-flight addModule()/AudioWorkletNode setup (surfaced as
  // "AudioWorkletNode cannot be created: No execution context available").
  useEffect(() => () => capture.stop(), [capture.stop]);

  return {
    recordingState,
    latest,
    classification: latest?.classification ?? null,
    confidence: latest?.confidence ?? null,
    errorMessage,
    micPermissionState: capture.permissionState,
    visualFallbackPulse,
    uncalibrated,
    startRecording,
    stopRecording,
  };
}
