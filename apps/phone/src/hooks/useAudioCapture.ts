import { useCallback, useEffect, useRef, useState } from 'react';
import { PCMChunker, TARGET_SAMPLE_RATE, downsampleFloat32, float32ToPCM16 } from '../lib/pcm';

export type MicPermissionState = 'unknown' | 'requesting' | 'granted' | 'denied' | 'error';

interface UseAudioCaptureOptions {
  onChunk: (bytes: ArrayBuffer) => void;
}

/**
 * Mic permission + Web Audio API capture, resampled to the DSP service's
 * 16kHz mono PCM16 contract and handed to `onChunk` in ~250ms frames.
 * Capture-only: the graph is never connected to `audioContext.destination`,
 * so there's no monitoring loopback/echo.
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

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      setPermissionState('granted');

      await audioContext.audioWorklet.addModule('/worklets/pcm-capture-processor.js');

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const worklet = new AudioWorkletNode(audioContext, 'pcm-capture-processor');
      workletNodeRef.current = worklet;

      const chunker = new PCMChunker((bytes) => onChunkRef.current(bytes));
      chunkerRef.current = chunker;

      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const downsampled = downsampleFloat32(event.data, audioContext.sampleRate, TARGET_SAMPLE_RATE);
        chunker.push(float32ToPCM16(downsampled));
      };

      source.connect(worklet);
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setError(denied ? 'Microphone permission denied' : err instanceof Error ? err.message : 'Failed to access microphone');
      setPermissionState(denied ? 'denied' : 'error');
      stop();
      throw err;
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { start, stop, permissionState, error };
}
