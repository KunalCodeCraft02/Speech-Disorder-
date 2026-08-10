// PCM/resampling utilities. The DSP pipeline's audio contract
// (../dsp/config.ts `sampleRate`) is mono Float32 at 16kHz — but mic input
// runs at whatever native rate the hardware/OS gives. That's typically
// 44.1kHz or 48kHz for a phone's built-in mic, but Bluetooth earpods
// (HFP/SCO profile) commonly report a *lower* native rate — often exactly
// 8kHz or 16kHz, sometimes with a different clock than the device's other
// audio paths — so every chunk is resampled (up OR down) to the target
// rate here before it reaches the DSP pipeline, rather than assuming the
// native rate is always >= 16kHz.
//
// Everything here stays in-process (no socket, no REST) — the pipeline
// runs client-side, so audio never needs PCM16 requantization or base64
// encoding for the wire; it's kept as Float32 end to end.

export const TARGET_SAMPLE_RATE = 16000;
const CHUNK_DURATION_SEC = 0.25;
const CHUNK_SAMPLES = Math.round(TARGET_SAMPLE_RATE * CHUNK_DURATION_SEC);

/**
 * Averaging decimation from `inputRate` down to `outputRate`. Not a proper
 * anti-aliasing low-pass filter — a production pipeline would band-limit
 * before decimating — but the averaging (rather than nearest-neighbor
 * picking) already knocks down most of the aliasing energy and is cheap
 * enough to run on the main thread per 2048-sample block.
 */
function downsampleFloat32(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  const ratio = inputRate / outputRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    output[i] = count > 0 ? sum / count : input[Math.min(start, input.length - 1)];
  }
  return output;
}

/**
 * Linear-interpolation upsampling from `inputRate` up to `outputRate`.
 * Used when a mic (typically Bluetooth earpods over HFP/SCO) reports a
 * native rate below the DSP pipeline's 16kHz target — without this, audio
 * would silently pass through at its lower native rate, violating the
 * pipeline's sample-rate contract and skewing every frequency-based
 * measurement (pitch search range, frame/hop durations, etc).
 */
function upsampleFloat32(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (input.length === 0) return input;
  const ratio = outputRate / inputRate;
  const outputLength = Math.max(1, Math.round(input.length * ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcPos = i / ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(input.length - 1, idx0 + 1);
    const frac = srcPos - idx0;
    output[i] = input[Math.min(idx0, input.length - 1)] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

/** Resamples in whichever direction is needed to reach `outputRate` — degrades gracefully whether the mic's native rate is above or below the target. */
export function resampleFloat32(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  return inputRate > outputRate ? downsampleFloat32(input, inputRate, outputRate) : upsampleFloat32(input, inputRate, outputRate);
}

/**
 * Accumulates Float32 samples across worklet callbacks (whose block size
 * doesn't line up with a clean duration once resampled) and flushes
 * fixed ~250ms frames to the live DSP pipeline.
 */
export class PCMChunker {
  private buffer = new Float32Array(0);
  private readonly onChunk: (samples: Float32Array) => void;
  private readonly chunkSamples: number;

  constructor(onChunk: (samples: Float32Array) => void, chunkSamples = CHUNK_SAMPLES) {
    this.onChunk = onChunk;
    this.chunkSamples = chunkSamples;
  }

  push(samples: Float32Array) {
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;

    while (this.buffer.length >= this.chunkSamples) {
      const chunk = this.buffer.slice(0, this.chunkSamples);
      this.buffer = this.buffer.slice(this.chunkSamples);
      this.onChunk(chunk);
    }
  }

  /** Sends whatever is left (a partial frame) — call on stop() so the tail isn't lost. */
  flush() {
    if (this.buffer.length > 0) {
      this.onChunk(this.buffer);
      this.buffer = new Float32Array(0);
    }
  }
}

/**
 * Accumulates Float32 samples into one growing buffer instead of flushing
 * fixed-size frames — used by calibration, which records a fixed ~20s clip
 * and analyzes it as one whole-clip pass rather than streaming it.
 */
export class PCMAccumulator {
  private buffer = new Float32Array(0);

  push(samples: Float32Array) {
    const merged = new Float32Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;
  }

  get sampleCount() {
    return this.buffer.length;
  }

  getAll(): Float32Array {
    return this.buffer;
  }
}
