// Streaming audio preprocessing: bandpass filter -> spectral-subtraction
// noise reduction -> AGC normalization. Ported from
// services/dsp-service/app/pipeline/preprocessing.py. Unlike the Python
// service (which received PCM16 bytes over a WebSocket), this runs
// in-browser directly on Float32 samples already resampled to
// `settings.sampleRate` by the capture pipeline (see ../lib/pcm.ts) — so
// there is no PCM16 <-> float conversion layer here at all.

import * as C from './constants';
import { irfftFromMagPhase, rfftMagPhase } from './fft';
import { BiquadCascade, designBandpassButterworth } from './butterworth';

export class BandpassFilter {
  private readonly cascade: BiquadCascade;

  constructor(sampleRate: number, lowHz = C.BANDPASS_LOW_HZ, highHz = C.BANDPASS_HIGH_HZ, order = C.BANDPASS_ORDER) {
    const sos = designBandpassButterworth(order, lowHz, highHz, sampleRate);
    this.cascade = new BiquadCascade(sos);
  }

  process(x: Float32Array): Float32Array {
    if (x.length === 0) return x;
    return this.cascade.process(x);
  }
}

function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function rms(frame: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Overlap-add spectral subtraction (Boll, 1979) with an adaptive noise
 * floor estimated from the quietest recent frames, followed by
 * frame-synchronous AGC normalization — a direct port of
 * StreamingSpectralDenoiser (weighted OLA, Hann analysis+synthesis window
 * at 50% hop).
 */
export class StreamingSpectralDenoiser {
  private readonly frameSize: number;
  private readonly hopSize: number;
  private readonly window: Float32Array;

  private inputTail = new Float32Array(0);
  private outputOverlap = new Float32Array(0);
  private noiseMag: Float64Array | null = null;
  private readonly recentFrameDb: number[] = [];
  private agcGain = 1.0;

  constructor(frameSize = C.STFT_FRAME_SIZE, hopSize = C.STFT_HOP_SIZE) {
    this.frameSize = frameSize;
    this.hopSize = hopSize;
    this.window = hannWindow(frameSize);
  }

  private updateNoiseEstimate(mag: Float64Array, frameDb: number): void {
    if (this.noiseMag === null) {
      this.noiseMag = mag.slice();
      this.recentFrameDb.push(frameDb);
      if (this.recentFrameDb.length > 50) this.recentFrameDb.shift();
      return;
    }

    const quietThreshold = this.recentFrameDb.length >= 5 ? percentile(this.recentFrameDb, C.NOISE_UPDATE_PERCENTILE) : frameDb;
    const alpha = frameDb <= quietThreshold ? C.NOISE_ESTIMATE_SMOOTHING : 0.995;

    for (let i = 0; i < this.noiseMag.length; i++) {
      this.noiseMag[i] = alpha * this.noiseMag[i] + (1 - alpha) * mag[i];
    }
    this.recentFrameDb.push(frameDb);
    if (this.recentFrameDb.length > 50) this.recentFrameDb.shift();
  }

  /**
   * Returns the denoised+AGC'd audio (as before) plus one pre-AGC loudness
   * reading (dB) per emitted hop, in order -- `preAgcLoudnessDb.length *
   * hopSize === audio.length` always holds, so a caller can timestamp each
   * entry against its own running output-sample cursor (see
   * AudioPreprocessor.process()).
   *
   * The pre-AGC reading is taken from `reconFrame` (after spectral
   * subtraction, before the AGC gain stage) rather than the final AGC'd
   * output: AGC deliberately drives RMS toward a fixed AGC_TARGET_RMS, which
   * erases genuine loud-vs-quiet variation -- a signal that's been
   * normalized to a constant target can't be used to detect "the patient is
   * speaking too loud" (that's what was collapsing loudnessDb toward N/A /
   * always-or-never-triggering rather than a real value).
   */
  process(chunk: Float32Array): { audio: Float32Array; preAgcLoudnessDb: number[] } {
    if (chunk.length) {
      const merged = new Float32Array(this.inputTail.length + chunk.length);
      merged.set(this.inputTail);
      merged.set(chunk, this.inputTail.length);
      this.inputTail = merged;
    }

    const readyChunks: Float32Array[] = [];
    const preAgcLoudnessDb: number[] = [];

    while (this.inputTail.length >= this.frameSize) {
      const frame = this.inputTail.subarray(0, this.frameSize);
      this.inputTail = this.inputTail.subarray(this.hopSize);

      const windowed = new Float64Array(this.frameSize);
      for (let i = 0; i < this.frameSize; i++) windowed[i] = frame[i] * this.window[i];

      const { mag, phase } = rfftMagPhase(windowed, this.frameSize);
      const frameDb = 20 * Math.log10(rms(frame) + C.EPS);
      this.updateNoiseEstimate(mag, frameDb);

      const noiseMag = this.noiseMag!;
      const subMag = new Float64Array(mag.length);
      for (let i = 0; i < mag.length; i++) {
        const floor = C.NOISE_SPECTRAL_FLOOR * mag[i];
        subMag[i] = Math.max(mag[i] - C.NOISE_OVERSUBTRACTION_FACTOR * noiseMag[i], floor);
      }

      const reconFrame = irfftFromMagPhase(subMag, phase, this.frameSize);

      const frameRms = rms(reconFrame) + C.EPS;
      preAgcLoudnessDb.push(20 * Math.log10(frameRms));

      const targetGain = Math.min(C.AGC_MAX_GAIN, Math.max(C.AGC_MIN_GAIN, C.AGC_TARGET_RMS / frameRms));
      this.agcGain = C.AGC_SMOOTHING * this.agcGain + (1 - C.AGC_SMOOTHING) * targetGain;

      const synthesized = new Float32Array(this.frameSize);
      for (let i = 0; i < this.frameSize; i++) synthesized[i] = reconFrame[i] * this.agcGain * this.window[i];

      const outLen = Math.max(this.outputOverlap.length, this.frameSize);
      const buf = new Float32Array(outLen);
      buf.set(this.outputOverlap);
      for (let i = 0; i < this.frameSize; i++) buf[i] += synthesized[i];

      readyChunks.push(buf.slice(0, this.hopSize));
      this.outputOverlap = buf.slice(this.hopSize);
    }

    if (readyChunks.length === 0) return { audio: new Float32Array(0), preAgcLoudnessDb: [] };
    const totalLen = readyChunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of readyChunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return { audio: out, preAgcLoudnessDb };
  }
}

export interface LoudnessSample {
  /** Seconds, same absolute timeline as VoiceActivityDetector's FrameDecision.time (both are elapsed denoised-output samples / sampleRate, counted from session start). */
  time: number;
  /** Pre-AGC dB (see StreamingSpectralDenoiser.process()'s doc comment). */
  db: number;
}

export class AudioPreprocessor {
  private readonly bandpass: BandpassFilter;
  private readonly denoiser: StreamingSpectralDenoiser;
  private readonly sampleRate: number;
  private readonly hopSize: number;
  private outputSamplesEmitted = 0;

  constructor(sampleRate: number, hopSize: number = C.STFT_HOP_SIZE) {
    this.bandpass = new BandpassFilter(sampleRate);
    this.denoiser = new StreamingSpectralDenoiser();
    this.sampleRate = sampleRate;
    this.hopSize = hopSize;
  }

  process(chunk: Float32Array): { audio: Float32Array; loudnessSamples: LoudnessSample[] } {
    const filtered = this.bandpass.process(chunk);
    const { audio, preAgcLoudnessDb } = this.denoiser.process(filtered);

    const loudnessSamples: LoudnessSample[] = preAgcLoudnessDb.map((db, i) => ({
      time: (this.outputSamplesEmitted + i * this.hopSize) / this.sampleRate,
      db,
    }));
    this.outputSamplesEmitted += audio.length;

    return { audio, loudnessSamples };
  }
}

/** One-shot peak normalization — used by the non-streaming calibration analysis path. */
export function normalizePeak(x: Float32Array, targetPeak = 0.9): Float32Array {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < C.EPS) return x;
  const scale = targetPeak / peak;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * scale;
  return out;
}
