// Energy + zero-crossing-rate voice activity detection. Ported from
// services/dsp-service/app/pipeline/vad.py.

import * as C from './constants';

export interface FrameDecision {
  time: number; // seconds, start of frame within the session's audio timeline
  isSpeech: boolean;
  energyDb: number;
}

function zeroCrossingRate(frame: Float32Array): number {
  if (frame.length < 2) return 0;
  let crossings = 0;
  let prevSign = frame[0] >= 0 ? 1 : -1;
  for (let i = 1; i < frame.length; i++) {
    const sign = frame[i] >= 0 ? 1 : -1;
    if (sign !== prevSign) crossings++;
    prevSign = sign;
  }
  return crossings / (frame.length - 1);
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

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

export class VoiceActivityDetector {
  readonly sampleRate: number;
  private readonly frameLen: number;
  private readonly hopLen: number;

  private tail = new Float32Array(0);
  private samplesConsumed = 0;

  private readonly quietEnergyHistory: number[] = [];
  private readonly historyLen: number;

  private confirmedSpeech = false;
  private onsetCounter = 0;
  private hangoverCounter = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.frameLen = Math.floor((sampleRate * C.VAD_FRAME_MS) / 1000);
    this.hopLen = Math.floor((sampleRate * C.VAD_HOP_MS) / 1000);
    this.historyLen = Math.max(5, Math.floor((C.VAD_NOISE_FLOOR_WINDOW_SEC * 1000) / C.VAD_HOP_MS));
  }

  get hopSeconds(): number {
    return this.hopLen / this.sampleRate;
  }

  process(chunk: Float32Array): FrameDecision[] {
    if (chunk.length) {
      const merged = new Float32Array(this.tail.length + chunk.length);
      merged.set(this.tail);
      merged.set(chunk, this.tail.length);
      this.tail = merged;
    }

    const decisions: FrameDecision[] = [];

    while (this.tail.length >= this.frameLen) {
      const frame = this.tail.subarray(0, this.frameLen);
      const frameTime = this.samplesConsumed / this.sampleRate;
      this.tail = this.tail.subarray(this.hopLen);
      this.samplesConsumed += this.hopLen;

      const energyDb = 20 * Math.log10(rms(frame) + C.EPS);
      const zcr = zeroCrossingRate(frame);

      const noiseFloorDb =
        this.quietEnergyHistory.length >= 5
          ? percentile(this.quietEnergyHistory, C.VAD_NOISE_FLOOR_PERCENTILE)
          : energyDb - C.VAD_ENERGY_MARGIN_DB;

      const rawSpeech = energyDb > noiseFloorDb + C.VAD_ENERGY_MARGIN_DB && zcr <= C.VAD_ZCR_MAX;

      if (!rawSpeech) {
        this.quietEnergyHistory.push(energyDb);
        if (this.quietEnergyHistory.length > this.historyLen) this.quietEnergyHistory.shift();
      }

      if (this.confirmedSpeech) {
        if (rawSpeech) {
          this.hangoverCounter = 0;
        } else {
          this.hangoverCounter++;
          if (this.hangoverCounter >= C.VAD_HANGOVER_FRAMES) {
            this.confirmedSpeech = false;
            this.onsetCounter = 0;
          }
        }
      } else {
        if (rawSpeech) {
          this.onsetCounter++;
          if (this.onsetCounter >= C.VAD_ONSET_FRAMES) {
            this.confirmedSpeech = true;
            this.hangoverCounter = 0;
          }
        } else {
          this.onsetCounter = 0;
        }
      }

      decisions.push({ time: frameTime, isSpeech: this.confirmedSpeech, energyDb });
    }

    return decisions;
  }
}
