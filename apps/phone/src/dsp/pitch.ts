// Autocorrelation-based F0 (pitch) estimation. Stateless — recomputed
// fresh over the trailing analysis window every pass, exactly like
// services/dsp-service/app/pipeline/pitch.py.

import * as C from './constants';
import { autocorrelationViaFFT } from './fft';

export interface PitchFrame {
  time: number;
  f0Hz: number | null;
  voiced: boolean;
}

function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export function estimatePitchContour(audio: Float32Array, sampleRate: number, startTime = 0): PitchFrame[] {
  const frameLen = Math.floor((sampleRate * C.PITCH_FRAME_MS) / 1000);
  const hopLen = Math.floor((sampleRate * C.PITCH_HOP_MS) / 1000);
  const lagMin = Math.max(1, Math.floor(sampleRate / C.PITCH_MAX_HZ));
  const lagMax = Math.floor(sampleRate / C.PITCH_MIN_HZ);

  if (audio.length < frameLen) return [];

  const window = hannWindow(frameLen);
  let fftLen = 1;
  while (fftLen < 2 * frameLen) fftLen *= 2;

  const frames: PitchFrame[] = [];
  let pos = 0;

  while (pos + frameLen <= audio.length) {
    const t = startTime + pos / sampleRate;
    const windowed = new Float64Array(frameLen);
    for (let i = 0; i < frameLen; i++) windowed[i] = audio[pos + i] * window[i];

    const autocorr = autocorrelationViaFFT(windowed, fftLen, frameLen);

    if (autocorr[0] <= C.EPS || lagMax >= autocorr.length) {
      frames.push({ time: t, f0Hz: null, voiced: false });
      pos += hopLen;
      continue;
    }

    const norm0 = autocorr[0];
    let peakOffset = 0;
    let peakValue = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      const v = autocorr[lag] / norm0;
      if (v > peakValue) {
        peakValue = v;
        peakOffset = lag - lagMin;
      }
    }
    const lag = lagMin + peakOffset;

    if (peakValue >= C.PITCH_VOICING_THRESHOLD && lag > 0) {
      frames.push({ time: t, f0Hz: sampleRate / lag, voiced: true });
    } else {
      frames.push({ time: t, f0Hz: null, voiced: false });
    }

    pos += hopLen;
  }

  return frames;
}

export function voicedTimesArray(frames: PitchFrame[]): Float64Array {
  const voiced = frames.filter((f) => f.voiced);
  return Float64Array.from(voiced.map((f) => f.time));
}

export function voicedF0Array(frames: PitchFrame[]): Float64Array {
  const voiced = frames.filter((f) => f.voiced);
  return Float64Array.from(voiced.map((f) => f.f0Hz as number));
}
