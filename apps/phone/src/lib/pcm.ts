// PCM conversion utilities. The DSP service's audio contract (see
// services/dsp-service/app/core/config.py `sample_rate`, and the wire
// contract documented in services/gateway/src/services/dspClient.js) is
// mono PCM16LE at 16kHz — but browser mics run at whatever native rate
// the hardware gives (typically 44.1kHz or 48kHz), so every chunk gets
// downsampled and requantized here before it goes over the wire.

export const TARGET_SAMPLE_RATE = 16000;
const CHUNK_DURATION_SEC = 0.25;
const CHUNK_SAMPLES = Math.round(TARGET_SAMPLE_RATE * CHUNK_DURATION_SEC); // 4000 samples = 8000 bytes

/**
 * Averaging decimation from `inputRate` down to `outputRate`. Not a proper
 * anti-aliasing low-pass filter — a production pipeline would band-limit
 * before decimating — but the averaging (rather than nearest-neighbor
 * picking) already knocks down most of the aliasing energy and is cheap
 * enough to run on the main thread per 2048-sample block.
 */
export function downsampleFloat32(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (outputRate >= inputRate) return input;

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

/** Float32 [-1, 1] samples -> signed 16-bit PCM, little-endian (native on all our targets). */
export function float32ToPCM16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

/**
 * Accumulates PCM16 samples across worklet callbacks (whose block size
 * doesn't line up with a clean duration once resampled) and flushes
 * fixed ~250ms / 8000-byte frames — well under the gateway's 64KB
 * audio:chunk ceiling (services/gateway/src/sockets/handlers/audio.handler.js)
 * and small enough to keep vibration feedback latency low.
 */
export class PCMChunker {
  private buffer = new Int16Array(0);
  private readonly onChunk: (bytes: ArrayBuffer) => void;
  private readonly chunkSamples: number;

  constructor(onChunk: (bytes: ArrayBuffer) => void, chunkSamples = CHUNK_SAMPLES) {
    this.onChunk = onChunk;
    this.chunkSamples = chunkSamples;
  }

  push(samples: Int16Array) {
    const merged = new Int16Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;

    while (this.buffer.length >= this.chunkSamples) {
      const chunk = this.buffer.slice(0, this.chunkSamples);
      this.buffer = this.buffer.slice(this.chunkSamples);
      this.onChunk(chunk.buffer);
    }
  }

  /** Sends whatever is left (a partial frame) — call on stop() so the tail isn't lost. */
  flush() {
    if (this.buffer.length > 0) {
      this.onChunk(this.buffer.buffer);
      this.buffer = new Int16Array(0);
    }
  }
}

/**
 * Accumulates PCM16 samples into one growing buffer instead of flushing
 * fixed-size frames — used by calibration, which records a fixed ~30s
 * clip and submits it as a single REST payload rather than streaming it.
 */
export class PCMAccumulator {
  private buffer = new Int16Array(0);

  push(samples: Int16Array) {
    const merged = new Int16Array(this.buffer.length + samples.length);
    merged.set(this.buffer);
    merged.set(samples, this.buffer.length);
    this.buffer = merged;
  }

  get sampleCount() {
    return this.buffer.length;
  }

  getAll(): Int16Array {
    return this.buffer;
  }
}

/**
 * Base64-encodes PCM16 samples in fixed-size chunks — `String.fromCharCode(...bytes)`
 * on the full ~1MB byte array in one call would blow the engine's argument-count
 * limit, so this feeds it 32KB at a time instead.
 */
export function int16ArrayToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
