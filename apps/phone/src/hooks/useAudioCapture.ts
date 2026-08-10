import { useCallback, useEffect, useRef, useState } from 'react';
import { PCMChunker, TARGET_SAMPLE_RATE, resampleFloat32 } from '../lib/pcm';
import { describeMicErrorVerbose, openMicStream } from '../lib/micStream';

export type MicPermissionState = 'unknown' | 'requesting' | 'granted' | 'denied' | 'error';

interface UseAudioCaptureOptions {
  onChunk: (samples: Float32Array) => void;
}

/**
 * Mic permission + Web Audio API capture, resampled to the local DSP
 * pipeline's 16kHz mono Float32 contract and handed to `onChunk` in ~250ms
 * frames. Capture-only: the graph is never connected to
 * `audioContext.destination`, so there's no monitoring loopback/echo.
 *
 * Once Bluetooth earpods are connected as the OS's active input device,
 * `getUserMedia` picks them up automatically — no earpod-specific code is
 * needed here. `resampleFloat32` (../lib/pcm.ts) handles either direction,
 * so it doesn't matter whether the earpods' mic reports a native rate
 * above or below 16kHz.
 */
export function useAudioCapture({ onChunk }: UseAudioCaptureOptions) {
  const [permissionState, setPermissionState] = useState<MicPermissionState>('unknown');
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const chunkerRef = useRef<PCMChunker | null>(null);

  // Worklet callbacks bind once per start(); keep the latest onChunk
  // without needing to tear the audio graph down every render.
  const onChunkRef = useRef(onChunk);
  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  const stop = useCallback(() => {
    chunkerRef.current?.flush();
    chunkerRef.current = null;

    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setPermissionState('requesting');

    // Create (and resume) the AudioContext as the very first thing, still
    // inside the click handler's call stack — some mobile browsers only
    // treat audio as user-activated if it's tied directly to the gesture,
    // not after an intervening `await getUserMedia(...)`.
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    try {
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const stream = await openMicStream();
      streamRef.current = stream;
      setPermissionState('granted');

      await audioContext.audioWorklet.addModule('/worklets/pcm-capture-processor.js');

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const worklet = new AudioWorkletNode(audioContext, 'pcm-capture-processor');
      workletNodeRef.current = worklet;

      const chunker = new PCMChunker((samples) => onChunkRef.current(samples));
      chunkerRef.current = chunker;

      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const resampled = resampleFloat32(event.data, audioContext.sampleRate, TARGET_SAMPLE_RATE);
        chunker.push(resampled);
      };

      source.connect(worklet);
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setError(describeMicErrorVerbose(err));
      setPermissionState(denied ? 'denied' : 'error');
      stop();
      throw err;
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { start, stop, permissionState, error };
}
