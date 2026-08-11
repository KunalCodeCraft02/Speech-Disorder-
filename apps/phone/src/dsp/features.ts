// Session-level running statistics and the full feature-set computation.
// Ported from services/dsp-service/app/pipeline/features.py.

import * as C from './constants';
import type { BaselineProfile } from './baseline';
import type { PitchFrame } from './pitch';
import { voicedF0Array } from './pitch';
import type { FrameDecision } from './vad';
import { segmentDuration, type Segment, type SegmentKind } from './segmentation';

export interface FeatureSet {
  elapsedSec: number;
  articulationRateSPS: number;
  speechRateWPM: number;
  averageSyllableDurationSec: number | null;
  interSyllableIntervalSec: number | null;
  pauseDurationSec: number | null;
  pauseFrequencyPerMin: number;
  pauseCount: number;
  speechToPauseRatio: number | null;
  interPausalUnitLengthSec: number | null;
  ipuCount: number;
  /** Cumulative time (sec) classified as speech so far this session/clip -- distinct from elapsedSec, which also counts silence/pauses. */
  speakingDurationSec: number;
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
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

/** O(1)-memory accumulator for one session (deques trimmed to the rolling analysis window; `recentNucleiTimes30s` trimmed to a fixed 30s instead, for wordsPerLast30Sec). */
export class RunningStats {
  totalPauseCount = 0;
  totalPauseSec = 0;
  totalIpuCount = 0;
  totalIpuSec = 0;
  totalNucleiCount = 0;

  private sumIsi = 0;
  private sumsqIsi = 0;
  private countIsi = 0;
  private lastNucleusTime: number | null = null;
  private lastNucleusPauseStamp = 0;

  recentNucleiTimes: number[] = [];
  recentNucleiTimes30s: number[] = [];
  recentFrameDecisions: FrameDecision[] = [];
  recentSegments: Segment[] = [];

  addSegments(segments: Segment[], windowSec: number, currentTime: number): void {
    for (const seg of segments) {
      if (seg.kind === 'speech') {
        this.totalIpuCount++;
        this.totalIpuSec += segmentDuration(seg);
      } else {
        this.totalPauseCount++;
        this.totalPauseSec += segmentDuration(seg);
      }
      this.recentSegments.push(seg);
    }

    const cutoff = currentTime - windowSec;
    while (this.recentSegments.length && this.recentSegments[0].end < cutoff) this.recentSegments.shift();
  }

  addFrameDecisions(decisions: FrameDecision[], windowSec: number): void {
    if (!decisions.length) return;
    this.recentFrameDecisions.push(...decisions);
    const cutoff = decisions[decisions.length - 1].time - windowSec;
    while (this.recentFrameDecisions.length && this.recentFrameDecisions[0].time < cutoff) this.recentFrameDecisions.shift();
  }

  addNuclei(nucleiTimes: number[], windowSec: number, currentTime: number): void {
    for (const t of nucleiTimes) {
      this.totalNucleiCount++;

      if (this.lastNucleusTime !== null && this.lastNucleusPauseStamp === this.totalPauseCount) {
        const gap = t - this.lastNucleusTime;
        if (gap > 0) {
          this.sumIsi += gap;
          this.sumsqIsi += gap * gap;
          this.countIsi++;
        }
      }

      this.lastNucleusTime = t;
      this.lastNucleusPauseStamp = this.totalPauseCount;
      this.recentNucleiTimes.push(t);
      this.recentNucleiTimes30s.push(t);
    }

    const cutoff = currentTime - windowSec;
    while (this.recentNucleiTimes.length && this.recentNucleiTimes[0] < cutoff) this.recentNucleiTimes.shift();

    const cutoff30s = currentTime - C.WORDS_RING_BUFFER_SEC;
    while (this.recentNucleiTimes30s.length && this.recentNucleiTimes30s[0] < cutoff30s) this.recentNucleiTimes30s.shift();
  }

  windowedNucleiCount(): number {
    return this.recentNucleiTimes.length;
  }

  wordsPerLast30Sec(): number {
    return this.recentNucleiTimes30s.length / C.SYLLABLES_PER_WORD;
  }

  windowedPhonationSec(windowStart: number, windowEnd: number, openKind: SegmentKind, openStart: number, openEnd: number): number {
    let total = 0;
    for (const seg of this.recentSegments) {
      if (seg.kind !== 'speech') continue;
      const overlap = Math.min(seg.end, windowEnd) - Math.max(seg.start, windowStart);
      if (overlap > 0) total += overlap;
    }
    if (openKind === 'speech') {
      const overlap = Math.min(openEnd, windowEnd) - Math.max(openStart, windowStart);
      if (overlap > 0) total += overlap;
    }
    return total;
  }

  /** Relative dBFS-style frame energy (0 dBFS = digital full scale, so all real readings are negative) from the VAD's own energy estimate -- not a calibrated microphone-relative SPL measurement (Part 13). Averaged over recentFrameDecisions (already windowed), so a single loud/quiet frame doesn't move the displayed value on its own. */
  windowedLoudnessDb(): number {
    const speechEnergies = this.recentFrameDecisions.filter((d) => d.isSpeech).map((d) => d.energyDb);
    if (speechEnergies.length) return mean(speechEnergies);
    const allEnergies = this.recentFrameDecisions.map((d) => d.energyDb);
    return allEnergies.length ? mean(allEnergies) : -60.0;
  }

  windowedLoudnessStdDb(): number {
    const speechEnergies = this.recentFrameDecisions.filter((d) => d.isSpeech).map((d) => d.energyDb);
    return speechEnergies.length >= 2 ? std(speechEnergies) : 0;
  }

  meanIsi(): number | null {
    return this.countIsi > 0 ? this.sumIsi / this.countIsi : null;
  }

  isiCoefficientOfVariation(): number | null {
    if (this.countIsi < 2) return null;
    const m = this.sumIsi / this.countIsi;
    const variance = Math.max(0, this.sumsqIsi / this.countIsi - m * m);
    const s = Math.sqrt(variance);
    return m > C.EPS ? s / m : null;
  }

  meanIpuSec(): number | null {
    return this.totalIpuCount > 0 ? this.totalIpuSec / this.totalIpuCount : null;
  }

  meanPauseSec(): number | null {
    return this.totalPauseCount > 0 ? this.totalPauseSec / this.totalPauseCount : null;
  }

  pauseFrequencyPerMin(elapsedSec: number): number {
    const minutes = elapsedSec / 60;
    return minutes > C.EPS ? this.totalPauseCount / minutes : 0;
  }

  voiceActivityPercent(openKind: SegmentKind, openDuration: number, elapsedSec: number): number {
    const speechSec = this.totalIpuSec + (openKind === 'speech' ? openDuration : 0);
    return elapsedSec > C.EPS ? (100 * speechSec) / elapsedSec : 0;
  }

  speechToPauseRatio(openKind: SegmentKind, openDuration: number): number | null {
    const speechSec = this.totalIpuSec + (openKind === 'speech' ? openDuration : 0);
    const pauseSec = this.totalPauseSec + (openKind === 'pause' ? openDuration : 0);
    return pauseSec > C.EPS ? speechSec / pauseSec : null;
  }
}

function consistencyFromCv(cv: number | null): number {
  if (cv === null) return 1.0;
  return Math.min(1, Math.max(0, 1 - cv));
}

function compositeScore(articulationRate: number, baselineRate: number, consistency: number, voiceActivityRatio: number): number {
  const rateCloseness =
    baselineRate > C.EPS ? 1 - Math.min(1, Math.abs(articulationRate - baselineRate) / baselineRate) : 0.5;

  const activityGap = Math.abs(voiceActivityRatio - C.COMPOSITE_TARGET_VOICE_ACTIVITY) / C.COMPOSITE_TARGET_VOICE_ACTIVITY;
  const activityScore = 1 - Math.min(1, activityGap);

  const score =
    C.COMPOSITE_WEIGHT_RATE * rateCloseness + C.COMPOSITE_WEIGHT_CONSISTENCY * consistency + C.COMPOSITE_WEIGHT_ACTIVITY * activityScore;

  return Math.min(100, Math.max(0, score * 100));
}

/** Least-squares slope of y over x — used for rateTrend/meanPitchTrendHz. `x` is elapsed session time, robust to uneven window spacing. */
export function linearSlope(points: Array<[number, number]>): number | null {
  const n = points.length;
  if (n < 2) return null;
  const xMean = mean(points.map((p) => p[0]));
  const yMean = mean(points.map((p) => p[1]));
  let denom = 0;
  let numer = 0;
  for (const [x, y] of points) {
    denom += (x - xMean) ** 2;
    numer += (x - xMean) * (y - yMean);
  }
  if (denom < C.EPS) return 0;
  return numer / denom;
}

export function computeFeatureSet(
  stats: RunningStats,
  args: {
    elapsedSec: number;
    windowStart: number;
    windowEnd: number;
    openKind: SegmentKind;
    openStart: number;
    openEnd: number;
    pitchFrames: PitchFrame[];
    baseline: BaselineProfile;
  }
): FeatureSet {
  const { elapsedSec, windowStart, windowEnd, openKind, openStart, openEnd, pitchFrames, baseline } = args;

  const windowSec = windowEnd - windowStart;
  const openDuration = Math.max(0, openEnd - openStart);
  const effectiveWindow = elapsedSec > C.EPS ? Math.min(windowSec, elapsedSec) : windowSec;

  const windowedNuclei = stats.windowedNucleiCount();
  const windowedPhonation = stats.windowedPhonationSec(windowStart, windowEnd, openKind, openStart, openEnd);

  const articulationRate = windowedPhonation > C.EPS ? windowedNuclei / windowedPhonation : 0;
  const speechRateSps = effectiveWindow > C.EPS ? windowedNuclei / effectiveWindow : 0;
  const speechRateWpm = (speechRateSps * 60) / C.SYLLABLES_PER_WORD;

  const averageSyllableDuration = windowedNuclei > 0 ? windowedPhonation / windowedNuclei : null;

  const voicedF0 = voicedF0Array(pitchFrames);
  const meanPitch = voicedF0.length > 0 ? mean(Array.from(voicedF0)) : null;
  let pitchVariability: number | null;
  if (voicedF0.length > 1) pitchVariability = std(Array.from(voicedF0));
  else if (voicedF0.length === 1) pitchVariability = 0;
  else pitchVariability = null;

  const consistency = consistencyFromCv(stats.isiCoefficientOfVariation());
  const voiceActivityPct = stats.voiceActivityPercent(openKind, openDuration, elapsedSec);

  const composite = compositeScore(articulationRate, baseline.baselineArticulationRate, consistency, voiceActivityPct / 100);

  // Pause duration: 0 completed pauses is a real "no pauses" finding once
  // enough time has elapsed to expect one, not missing data -- only the
  // first couple of seconds are genuinely "not enough data yet" (N/A).
  const pauseDurationSec = stats.totalPauseCount > 0 ? stats.meanPauseSec() : elapsedSec >= C.MIN_ELAPSED_FOR_ZERO_METRIC_SEC ? 0 : null;

  // IPU length: fold the still-open speech segment in as a live sample so
  // one continuous run of speech (no completed IPU yet) still produces a
  // value instead of a blank one, and so the average tracks the segment
  // actually in progress rather than lagging a full pause behind.
  const openSpeechDuration = openKind === 'speech' ? openDuration : 0;
  const interPausalUnitLengthSec =
    openSpeechDuration > C.EPS ? (stats.totalIpuSec + openSpeechDuration) / (stats.totalIpuCount + 1) : stats.meanIpuSec();

  return {
    elapsedSec,
    articulationRateSPS: articulationRate,
    speechRateWPM: speechRateWpm,
    averageSyllableDurationSec: averageSyllableDuration,
    interSyllableIntervalSec: stats.meanIsi(),
    pauseDurationSec,
    pauseFrequencyPerMin: stats.pauseFrequencyPerMin(elapsedSec),
    pauseCount: stats.totalPauseCount,
    speechToPauseRatio: stats.speechToPauseRatio(openKind, openDuration),
    interPausalUnitLengthSec,
    ipuCount: stats.totalIpuCount + (openSpeechDuration > C.EPS ? 1 : 0),
    speakingDurationSec: stats.totalIpuSec + openSpeechDuration,
    meanPitchHz: meanPitch,
    pitchVariabilityHz: pitchVariability,
    loudnessDb: stats.windowedLoudnessDb(),
    voiceActivityPercent: voiceActivityPct,
    speechConsistency: consistency,
    compositeScore: composite,
    wordsPerLast30Sec: stats.wordsPerLast30Sec(),
    totalSyllablesSession: stats.totalNucleiCount,
    totalWordsSession: stats.totalNucleiCount / C.SYLLABLES_PER_WORD,
    loudnessVariabilityDb: stats.windowedLoudnessStdDb(),
  };
}
