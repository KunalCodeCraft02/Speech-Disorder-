import { useCallback, useEffect, useRef, useState } from 'react';
import { baselineFromStored } from '../dsp/baseline';
import { settings } from '../dsp/config';
import { SessionPipeline, type MetricsFrame } from '../dsp/sessionPipeline';
import { playBeep } from '../lib/beep';
import { getCalibration } from '../storage/calibration';
import { dateKeyFor, saveSession, type SessionSummary } from '../storage/sessions';
import { useAudioCapture } from './useAudioCapture';

export type RecordingState = 'idle' | 'requesting-permission' | 'recording' | 'stopping' | 'error';

const VIBRATE_SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const TACHYLALIA_VIBRATION_PATTERN = [80, 60, 80, 60, 80];

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
      if (VIBRATE_SUPPORTED) {
        navigator.vibrate(TACHYLALIA_VIBRATION_PATTERN);
      } else {
        playBeep();
        setVisualFallbackPulse((n) => n + 1);
      }
    }

    setLatest(frame);
  }, []);

  const capture = useAudioCapture({ onChunk: handleChunk });

  const startRecording = useCallback(async () => {
    if (recordingState === 'recording' || recordingState === 'requesting-permission') return;

    setErrorMessage(null);
    setRecordingState('requesting-permission');

    const calibration = await getCalibration();
    const baseline = baselineFromStored(calibration, settings);
    setUncalibrated(baseline === null);
    baselineRateRef.current = baseline?.baselineArticulationRate ?? null;

    try {
      await capture.start();
    } catch {
      setRecordingState('error');
      return;
    }

    pipelineRef.current = new SessionPipeline(newSessionId(), baseline, settings);
    sessionStartedAtRef.current = new Date().toISOString();
    lastElapsedRef.current = 0;
    tachylaliaAccumSecRef.current = 0;
    feedbackCountRef.current = 0;
    rateAccumRef.current = { sum: 0, count: 0 };
    setLatest(null);
    setRecordingState('recording');
  }, [capture, recordingState]);

  const stopRecording = useCallback(() => {
    if (recordingState !== 'recording') return;
    setRecordingState('stopping');
    capture.stop();

    const pipeline = pipelineRef.current;
    if (pipeline) {
      const durationSec = pipeline.elapsedSec;
      const startedAt = sessionStartedAtRef.current ?? new Date().toISOString();
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
      };
      // Fire-and-forget: a slow IndexedDB write must not block the UI from
      // returning to idle.
      if (durationSec > 0) void saveSession(summary);
    }

    pipelineRef.current = null;
    sessionStartedAtRef.current = null;
    setRecordingState('idle');
  }, [capture, recordingState]);

  useEffect(() => () => capture.stop(), [capture]);

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
