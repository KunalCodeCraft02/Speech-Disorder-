import { useCallback, useEffect, useRef, useState } from 'react';
import { PCMAccumulator, TARGET_SAMPLE_RATE, resampleFloat32 } from '../lib/pcm';
import { describeMicErrorVerbose, openMicStream } from '../lib/micStream';

export type CalibrationRecorderState = 'idle' | 'requesting-permission' | 'recording' | 'processing' | 'error';

export interface CalibrationRecording {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
}

const CANCELLED = new Error('Calibration cancelled');

/**
 * Captures a single fixed-duration mic recording (one ~20s calibration
 * reading) via the same Web Audio API pipeline as live sessions
 * (public/worklets/pcm-capture-processor.js + src/lib/pcm.ts), but
 * accumulates it into one buffer instead of streaming chunks. Resolves
 * with raw Float32 samples analyzed locally — no base64/REST payload,
 * since calibration never leaves the device.
 */
export function useCalibrationRecorder(durationSec = 20) {
  const [state, setState] = useState<CalibrationRecorderState>('idle');
  const [secondsRemaining, setSecondsRemaining] = useState(durationSec);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rejectRef = useRef<((reason: unknown) => void) | null>(null);

  const teardownAudio = useCallback(() => {
    if (workletRef.current) {
      workletRef.current.port.onmessage = null;
      workletRef.current.disconnect();
      workletRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
  }, []);

  const record = useCallback(async (): Promise<CalibrationRecording> => {
    setError(null);
    setSecondsRemaining(durationSec);
    setState('requesting-permission');

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    try {
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const stream = await openMicStream();
      streamRef.current = stream;

      await audioContext.audioWorklet.addModule('/worklets/pcm-capture-processor.js');

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(audioContext, 'pcm-capture-processor');
      workletRef.current = worklet;

      const accumulator = new PCMAccumulator();
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const resampled = resampleFloat32(event.data, audioContext.sampleRate, TARGET_SAMPLE_RATE);
        accumulator.push(resampled);
      };
      source.connect(worklet);

      setState('recording');

      await new Promise<void>((resolve, reject) => {
        rejectRef.current = reject;
        let remaining = durationSec;
        timerRef.current = setInterval(() => {
          remaining -= 1;
          setSecondsRemaining(Math.max(0, remaining));
          if (remaining <= 0) {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = null;
            resolve();
          }
        }, 1000);
      });
      rejectRef.current = null;

      setState('processing');
      const samples = accumulator.getAll();
      teardownAudio();

      return {
        samples,
        sampleRate: TARGET_SAMPLE_RATE,
        durationSec: samples.length / TARGET_SAMPLE_RATE,
      };
    } catch (err) {
      teardownAudio();
      if (err !== CANCELLED) {
        setError(describeMicErrorVerbose(err));
        setState('error');
      }
      throw err;
    }
  }, [durationSec, teardownAudio]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    rejectRef.current?.(CANCELLED);
    rejectRef.current = null;
    teardownAudio();
    setState('idle');
  }, [teardownAudio]);

  useEffect(() => cancel, [cancel]);

  return { state, secondsRemaining, error, record, cancel, isCancelled: (err: unknown) => err === CANCELLED };
}
