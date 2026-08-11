// Per-session orchestrator: owns one session's entire streaming state and
// wires preprocessing -> VAD -> segmentation -> nuclei detection -> pitch
// -> feature extraction -> classification together. Ported from
// services/dsp-service/app/pipeline/session_pipeline.py, running entirely
// in-browser: `processChunk` takes Float32 samples already resampled to
// `settings.sampleRate` (see ../lib/pcm.ts), not PCM16 bytes off a socket.

import * as C from './constants';
import { settings as defaultSettings, type Settings } from './config';
import type { BaselineProfile } from './baseline';
import { defaultBaselineProfile } from './baseline';
import { HysteresisClassifier, type Classification, type ClassificationResult } from './classifier';
import { computeFeatureSet, linearSlope, RunningStats, type FeatureSet } from './features';
import { estimatePitchContour, voicedTimesArray, type PitchFrame } from './pitch';
import { AudioPreprocessor } from './preprocessing';
import { SpeechSegmenter } from './segmentation';
import { detectSyllableNuclei } from './syllables';
import { VoiceActivityDetector } from './vad';

const ABNORMAL: Classification[] = ['tachylalia'];

function roundOrNull(value: number | null, digits: number): number | null {
  if (value === null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export interface MetricsFrame {
  type: 'metrics';
  ts: string;
  elapsedSec: number;
  classification: Classification;
  confidence: number;
  triggerFeedback: boolean;
  feedbackReason: Classification | null;
  sampleSufficient: boolean;
  zRate: number;
  zPause: number;
  zSyll: number;
  compositeZ: number;
  zInterSyllableInterval: number;
  zPauseDuration: number;
  zPauseFrequency: number;
  zIpuLength: number;
  zPitch: number;
  zLoudness: number;
  zVoiceActivity: number;

  articulationRateSPS: number;
  speechRateWPM: number;
  averageSyllableDurationSec: number | null;
  interSyllableIntervalSec: number | null;
  pauseDurationSec: number | null;
  pauseFrequencyPerMin: number;
  speechToPauseRatio: number | null;
  interPausalUnitLengthSec: number | null;
  meanPitchHz: number | null;
  pitchVariabilityHz: number | null;
  loudnessDb: number;
  voiceActivityPercent: number;
  speechConsistency: number;
  compositeScore: number;
  wordsPerLast30Sec: number;
  totalSyllablesSession: number;
  totalWordsSession: number;
  loudnessVariabilityDb: number;

  rateTrend: number | null;
  meanPitchTrendHz: number | null;
  timeInAbnormalStateSec: number;
  recoveryTimeSec: number | null;
}

function featureSetFields(f: FeatureSet) {
  return {
    articulationRateSPS: round(f.articulationRateSPS, 3),
    speechRateWPM: round(f.speechRateWPM, 2),
    averageSyllableDurationSec: roundOrNull(f.averageSyllableDurationSec, 4),
    interSyllableIntervalSec: roundOrNull(f.interSyllableIntervalSec, 4),
    pauseDurationSec: roundOrNull(f.pauseDurationSec, 3),
    pauseFrequencyPerMin: round(f.pauseFrequencyPerMin, 2),
    speechToPauseRatio: roundOrNull(f.speechToPauseRatio, 3),
    interPausalUnitLengthSec: roundOrNull(f.interPausalUnitLengthSec, 3),
    meanPitchHz: roundOrNull(f.meanPitchHz, 1),
    pitchVariabilityHz: roundOrNull(f.pitchVariabilityHz, 2),
    loudnessDb: round(f.loudnessDb, 2),
    voiceActivityPercent: round(f.voiceActivityPercent, 1),
    speechConsistency: round(f.speechConsistency, 3),
    compositeScore: round(f.compositeScore, 1),
    wordsPerLast30Sec: round(f.wordsPerLast30Sec, 2),
    totalSyllablesSession: f.totalSyllablesSession,
    totalWordsSession: round(f.totalWordsSession, 2),
    loudnessVariabilityDb: round(f.loudnessVariabilityDb, 2),
  };
}

export class SessionPipeline {
  readonly sessionId: string;
  readonly sampleRate: number;
  readonly settings: Settings;

  /** null = genuinely uncalibrated; the classifier only ever emits "uncalibrated" in that state. There is no silent population-default substitution for a real session. */
  baseline: BaselineProfile | null;
  private readonly descriptiveBaseline: BaselineProfile;

  private readonly preprocessor: AudioPreprocessor;
  private readonly vad: VoiceActivityDetector;
  private readonly segmenter: SpeechSegmenter;
  private readonly stats: RunningStats;
  private readonly classifier: HysteresisClassifier;

  private readonly windowSec: number;
  private readonly minEmitIntervalSec: number;
  private readonly warmupSec: number;

  private processedBuffer = new Float32Array(0);
  private processedBufferStartTime = 0;
  private totalSamplesIn = 0;
  private lastEmitTime: number | null = null;
  private nucleiCursorTime = 0;
  private windowsAnalyzed = 0;

  private readonly rateHistory: Array<[number, number]> = [];
  private readonly pitchHistory: Array<[number, number]> = [];
  private abnormalStateStart: number | null = null;
  private recoveryPendingSince: number | null = null;

  constructor(sessionId: string, baseline: BaselineProfile | null, settings: Settings = defaultSettings) {
    this.sessionId = sessionId;
    this.settings = settings;
    this.sampleRate = settings.sampleRate;

    this.baseline = baseline;
    this.descriptiveBaseline = baseline ?? defaultBaselineProfile(settings);

    this.preprocessor = new AudioPreprocessor(this.sampleRate);
    this.vad = new VoiceActivityDetector(this.sampleRate);
    this.segmenter = new SpeechSegmenter();
    this.stats = new RunningStats();
    this.classifier = new HysteresisClassifier(settings);

    this.windowSec = settings.analysisWindowSec;
    this.minEmitIntervalSec = settings.minEmitIntervalSec;
    this.warmupSec = settings.warmupSec;
  }

  get elapsedSec(): number {
    return this.totalSamplesIn / this.sampleRate;
  }

  /** `samples` is Float32 mono audio already resampled to `this.sampleRate`. Returns a metrics frame at most every `minEmitIntervalSec`, or null if there's nothing new to emit yet. */
  processChunk(samples: Float32Array): MetricsFrame | null {
    if (samples.length === 0) return null;

    this.totalSamplesIn += samples.length;
    const processedNew = this.preprocessor.process(samples);

    if (processedNew.length) {
      this.appendProcessed(processedNew);
      const decisions = this.vad.process(processedNew);
      if (decisions.length) {
        const newSegments = this.segmenter.process(decisions, this.vad.hopSeconds);
        this.stats.addSegments(newSegments, this.windowSec, this.elapsedSec);
        this.stats.addFrameDecisions(decisions, this.windowSec);
      }
    }

    const elapsed = this.elapsedSec;
    if (elapsed < this.warmupSec) return null;
    if (this.lastEmitTime !== null && elapsed - this.lastEmitTime < this.minEmitIntervalSec) return null;

    const frame = this.analyze(elapsed);
    this.lastEmitTime = elapsed;
    this.windowsAnalyzed++;
    return frame;
  }

  private appendProcessed(newSamples: Float32Array): void {
    const merged = new Float32Array(this.processedBuffer.length + newSamples.length);
    merged.set(this.processedBuffer);
    merged.set(newSamples, this.processedBuffer.length);
    this.processedBuffer = merged;

    const maxLen = Math.floor((this.windowSec + 1.0) * this.sampleRate);
    if (this.processedBuffer.length > maxLen) {
      const trim = this.processedBuffer.length - maxLen;
      this.processedBuffer = this.processedBuffer.slice(trim);
      this.processedBufferStartTime += trim / this.sampleRate;
    }
  }

  private trailingWindow(): [Float32Array, number, number] {
    const windowSamples = Math.floor(this.windowSec * this.sampleRate);
    const windowStartIndex = Math.max(0, this.processedBuffer.length - windowSamples);
    const audio = this.processedBuffer.slice(windowStartIndex);
    const startTime = this.processedBufferStartTime + windowStartIndex / this.sampleRate;
    const endTime = this.processedBufferStartTime + this.processedBuffer.length / this.sampleRate;
    return [audio, startTime, endTime];
  }

  /** Dedupes nuclei detected in this pass against the cursor left by the previous pass — a candidate re-estimated within NUCLEI_MIN_INTERVAL_SEC of the cursor is boundary re-detection jitter, not a new syllable. */
  private acceptNewNuclei(candidateNuclei: number[], acceptBefore: number): number[] {
    let cursor = this.nucleiCursorTime;
    const accepted: number[] = [];

    for (const t of candidateNuclei) {
      if (t <= acceptBefore && t > cursor + C.NUCLEI_MIN_INTERVAL_SEC) {
        accepted.push(t);
        cursor = t;
      }
    }

    if (accepted.length) {
      this.nucleiCursorTime = cursor;
    } else if (candidateNuclei.length) {
      this.nucleiCursorTime = Math.max(this.nucleiCursorTime, acceptBefore);
    }

    return accepted;
  }

  private updateTrendsAndState(features: FeatureSet, result: ClassificationResult, elapsed: number) {
    this.rateHistory.push([elapsed, features.articulationRateSPS]);
    if (this.rateHistory.length > C.TREND_WINDOW_COUNT) this.rateHistory.shift();
    const rateTrend = linearSlope(this.rateHistory);

    if (features.meanPitchHz !== null) {
      this.pitchHistory.push([elapsed, features.meanPitchHz]);
      if (this.pitchHistory.length > C.TREND_WINDOW_COUNT) this.pitchHistory.shift();
    }
    const pitchTrend = linearSlope(this.pitchHistory);

    let timeInAbnormal: number;
    if (ABNORMAL.includes(result.classification)) {
      if (this.abnormalStateStart === null) this.abnormalStateStart = elapsed;
      timeInAbnormal = elapsed - this.abnormalStateStart;
    } else {
      this.abnormalStateStart = null;
      timeInAbnormal = 0;
    }

    let recoveryTime: number | null = null;
    if (result.triggerFeedback) {
      this.recoveryPendingSince = elapsed;
    } else if (result.classification === 'normal' && this.recoveryPendingSince !== null) {
      recoveryTime = elapsed - this.recoveryPendingSince;
      this.recoveryPendingSince = null;
    }

    return {
      rateTrend: roundOrNull(rateTrend, 4),
      meanPitchTrendHz: roundOrNull(pitchTrend, 3),
      timeInAbnormalStateSec: round(timeInAbnormal, 2),
      recoveryTimeSec: roundOrNull(recoveryTime, 2),
    };
  }

  private analyze(elapsed: number): MetricsFrame {
    const [windowAudio, windowStartTime, windowEndTime] = this.trailingWindow();

    const pitchFrames = estimatePitchContour(windowAudio, this.sampleRate, windowStartTime);
    const voicedTimes = voicedTimesArray(pitchFrames);

    const candidateNuclei = detectSyllableNuclei(windowAudio, this.sampleRate, windowStartTime, voicedTimes);

    const acceptBefore = windowEndTime - C.NUCLEI_BOUNDARY_GUARD_SEC;
    const newNuclei = this.acceptNewNuclei(candidateNuclei, acceptBefore);

    this.stats.addNuclei(newNuclei, this.windowSec, elapsed);

    const [openKind, openStart, openEnd] = this.segmenter.openSegmentInfo();

    const features = computeFeatureSet(this.stats, {
      elapsedSec: elapsed,
      windowStart: windowStartTime,
      windowEnd: windowEndTime,
      openKind,
      openStart,
      openEnd,
      pitchFrames,
      baseline: this.descriptiveBaseline,
    });

    const syllablesInWindow = this.stats.windowedNucleiCount();
    const phonationInWindow = this.stats.windowedPhonationSec(windowStartTime, windowEndTime, openKind, openStart, openEnd);

    const result = this.classifier.update({
      articulationRate: features.articulationRateSPS,
      speechToPauseRatio: features.speechToPauseRatio,
      avgSyllableDurationSec: features.averageSyllableDurationSec,
      interSyllableIntervalSec: features.interSyllableIntervalSec,
      pauseDurationSec: features.pauseDurationSec,
      pauseFrequencyPerMin: features.pauseFrequencyPerMin,
      ipuLengthSec: features.interPausalUnitLengthSec,
      meanPitchHz: features.meanPitchHz,
      loudnessDb: features.loudnessDb,
      voiceActivityPercent: features.voiceActivityPercent,
      syllablesInWindow,
      phonationSecInWindow: phonationInWindow,
      baseline: this.baseline,
      currentTime: elapsed,
    });

    const trendFields = this.updateTrendsAndState(features, result, elapsed);

    return {
      type: 'metrics',
      ts: new Date().toISOString(),
      elapsedSec: round(features.elapsedSec, 2),
      classification: result.classification,
      confidence: round(result.confidence, 3),
      triggerFeedback: result.triggerFeedback,
      feedbackReason: result.feedbackReason,
      sampleSufficient: result.sampleSufficient,
      zRate: round(result.zRate, 3),
      zPause: round(result.zPause, 3),
      zSyll: round(result.zSyll, 3),
      compositeZ: round(result.compositeZ, 3),
      zInterSyllableInterval: round(result.zInterSyllableInterval, 3),
      zPauseDuration: round(result.zPauseDuration, 3),
      zPauseFrequency: round(result.zPauseFrequency, 3),
      zIpuLength: round(result.zIpuLength, 3),
      zPitch: round(result.zPitch, 3),
      zLoudness: round(result.zLoudness, 3),
      zVoiceActivity: round(result.zVoiceActivity, 3),
      ...featureSetFields(features),
      ...trendFields,
    };
  }

  buildSummary() {
    const elapsed = this.elapsedSec;
    const [windowAudio, windowStartTime, windowEndTime] = this.trailingWindow();
    const pitchFrames = windowAudio.length ? estimatePitchContour(windowAudio, this.sampleRate, windowStartTime) : [];
    const [openKind, openStart, openEnd] = this.segmenter.openSegmentInfo();

    const features = computeFeatureSet(this.stats, {
      elapsedSec: elapsed,
      windowStart: windowStartTime,
      windowEnd: windowEndTime,
      openKind,
      openStart,
      openEnd,
      pitchFrames,
      baseline: this.descriptiveBaseline,
    });

    return {
      type: 'summary' as const,
      sessionId: this.sessionId,
      durationSec: round(elapsed, 2),
      windowsAnalyzed: this.windowsAnalyzed,
      totalSyllables: this.stats.totalNucleiCount,
      totalPauses: this.stats.totalPauseCount,
      totalIpus: this.stats.totalIpuCount,
      finalMetrics: featureSetFields(features),
    };
  }
}

// --- Calibration analysis (non-streaming, whole-buffer clip analysis) ---

export interface CalibrationClipResult {
  durationSec: number;
  phonationSec: number;
  syllableCount: number;
  rateSamples: number[];
  pauseSamples: number[];
  syllableDurationSamples: number[];
  ipuLengthSamples: number[];
  interSyllableIntervalSamples: number[];
  pauseDurationSamples: number[];
  pauseFrequencySamples: number[];
  meanPitchSamples: number[];
  loudnessSamples: number[];
  voiceActivitySamples: number[];
  descriptive: {
    speechRateWPM: number;
    meanPitchHz: number | null;
    loudnessDb: number;
    pauseDurationSec: number | null;
    speechRatio: number;
    pauseRatio: number;
  };
}

/** Runs one full, independent pass of preprocess -> VAD -> segment -> pitch -> nuclei -> features over `pcmFloat`, with no streaming state carried in or out. */
function analyzeClip(pcmFloat: Float32Array, sampleRate: number, baseline: BaselineProfile): { features: FeatureSet; phonationSec: number; elapsed: number } {
  const preprocessor = new AudioPreprocessor(sampleRate);
  const vad = new VoiceActivityDetector(sampleRate);
  const segmenter = new SpeechSegmenter();
  const stats = new RunningStats();

  const processed = preprocessor.process(pcmFloat);
  const elapsed = pcmFloat.length / sampleRate;
  let pitchFrames: PitchFrame[] = [];

  if (processed.length) {
    const decisions = vad.process(processed);
    if (decisions.length) {
      const segments = segmenter.process(decisions, vad.hopSeconds);
      stats.addSegments(segments, elapsed + 1.0, elapsed);
      stats.addFrameDecisions(decisions, elapsed + 1.0);
    }

    pitchFrames = estimatePitchContour(processed, sampleRate);
    const voicedTimes = voicedTimesArray(pitchFrames);
    const nuclei = detectSyllableNuclei(processed, sampleRate, 0, voicedTimes);
    stats.addNuclei(nuclei, elapsed + 1.0, elapsed);
  }

  const [openKind, openStart, openEnd] = segmenter.openSegmentInfo();

  const features = computeFeatureSet(stats, {
    elapsedSec: elapsed,
    windowStart: 0,
    windowEnd: elapsed,
    openKind,
    openStart,
    openEnd,
    pitchFrames,
    baseline,
  });

  const phonationSec = stats.windowedPhonationSec(0, elapsed, openKind, openStart, openEnd);
  return { features, phonationSec, elapsed };
}

/** One calibration clip's contribution to a (2-clip, pooled) calibration attempt. */
export function analyzeCalibrationClip(pcmFloat: Float32Array, sampleRate: number, settings: Settings = defaultSettings): CalibrationClipResult {
  const defaultBaseline = defaultBaselineProfile(settings);
  const { features: wholeFeatures, phonationSec: wholePhonation, elapsed } = analyzeClip(pcmFloat, sampleRate, defaultBaseline);

  const subLen = Math.floor(settings.calibrationSubwindowSec * sampleRate);
  const rateSamples: number[] = [];
  const pauseSamples: number[] = [];
  const syllSamples: number[] = [];
  const ipuSamples: number[] = [];
  const isiSamples: number[] = [];
  const pauseDurationSamples: number[] = [];
  const pauseFrequencySamples: number[] = [];
  const meanPitchSamples: number[] = [];
  const loudnessSamples: number[] = [];
  const voiceActivitySamples: number[] = [];

  if (subLen > 0) {
    const nSub = Math.floor(pcmFloat.length / subLen);
    for (let i = 0; i < nSub; i++) {
      const chunk = pcmFloat.slice(i * subLen, (i + 1) * subLen);
      const { features: subFeatures } = analyzeClip(chunk, sampleRate, defaultBaseline);

      // Pause frequency / loudness / voice-activity are well-defined even
      // for a subwindow with no detected syllable (e.g. a silent 4s chunk),
      // so these are sampled unconditionally, unlike the syllable-dependent
      // group below.
      pauseFrequencySamples.push(subFeatures.pauseFrequencyPerMin);
      loudnessSamples.push(subFeatures.loudnessDb);
      voiceActivitySamples.push(subFeatures.voiceActivityPercent);
      if (subFeatures.pauseDurationSec !== null) pauseDurationSamples.push(subFeatures.pauseDurationSec);
      if (subFeatures.meanPitchHz !== null) meanPitchSamples.push(subFeatures.meanPitchHz);

      if (subFeatures.averageSyllableDurationSec === null) continue;
      rateSamples.push(subFeatures.articulationRateSPS);
      syllSamples.push(subFeatures.averageSyllableDurationSec);
      if (subFeatures.speechToPauseRatio !== null) pauseSamples.push(subFeatures.speechToPauseRatio);
      if (subFeatures.interPausalUnitLengthSec !== null) ipuSamples.push(subFeatures.interPausalUnitLengthSec);
      if (subFeatures.interSyllableIntervalSec !== null) isiSamples.push(subFeatures.interSyllableIntervalSec);
    }
  }

  const pauseSec = Math.max(0, elapsed - wholePhonation);

  return {
    durationSec: elapsed,
    phonationSec: wholePhonation,
    syllableCount: wholeFeatures.totalSyllablesSession,
    rateSamples,
    pauseSamples,
    syllableDurationSamples: syllSamples,
    ipuLengthSamples: ipuSamples,
    interSyllableIntervalSamples: isiSamples,
    pauseDurationSamples,
    pauseFrequencySamples,
    meanPitchSamples,
    loudnessSamples,
    voiceActivitySamples,
    descriptive: {
      speechRateWPM: round(wholeFeatures.speechRateWPM, 2),
      meanPitchHz: roundOrNull(wholeFeatures.meanPitchHz, 1),
      loudnessDb: round(wholeFeatures.loudnessDb, 2),
      pauseDurationSec: roundOrNull(wholeFeatures.pauseDurationSec, 3),
      speechRatio: round(wholeFeatures.voiceActivityPercent / 100, 3),
      pauseRatio: round(elapsed > C.EPS ? pauseSec / elapsed : 0, 3),
    },
  };
}
