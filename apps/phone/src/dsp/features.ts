// Session-level running statistics and the full feature-set computation.
// Ported from services/dsp-service/app/pipeline/features.py.

import * as C from './constants';
import type { BaselineProfile } from './baseline';
import type { PitchFrame } from './pitch';
import { voicedF0Array } from './pitch';
import type { FrameDecision } from './vad';
import type { LoudnessSample } from './preprocessing';
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
  loudnessDb: number | null;
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

/** Part C sanity-bound check: a value outside a param's physiologically-possible range is invalid for that window, never clamped-and-displayed. */
function withinBounds(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
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
  recentLoudnessSamples: LoudnessSample[] = [];

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

  addLoudnessSamples(samples: LoudnessSample[], windowSec: number): void {
    if (!samples.length) return;
    this.recentLoudnessSamples.push(...samples);
    const cutoff = samples[samples.length - 1].time - windowSec;
    while (this.recentLoudnessSamples.length && this.recentLoudnessSamples[0].time < cutoff) this.recentLoudnessSamples.shift();
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

  windowedPauseSec(windowStart: number, windowEnd: number, openKind: SegmentKind, openStart: number, openEnd: number): number {
    let total = 0;
    for (const seg of this.recentSegments) {
      if (seg.kind !== 'pause') continue;
      const overlap = Math.min(seg.end, windowEnd) - Math.max(seg.start, windowStart);
      if (overlap > 0) total += overlap;
    }
    if (openKind === 'pause') {
      const overlap = Math.min(openEnd, windowEnd) - Math.max(openStart, windowStart);
      if (overlap > 0) total += overlap;
    }
    return total;
  }

  /**
   * Speech-time-only pre-AGC loudness readings within [windowStart,
   * windowEnd] -- sourced from recentLoudnessSamples (see
   * preprocessing.ts's StreamingSpectralDenoiser.process() doc comment for
   * why these are taken BEFORE the AGC gain stage: AGC drives RMS toward a
   * fixed target, which erases the very loud-vs-quiet variation this metric
   * exists to measure). "Speech time" is deliberately re-derived from
   * recentSegments/the open segment (the same VAD-confirmed intervals
   * windowedPhonationSec uses), not from the loudness samples' own
   * amplitude, so a loud noise burst that VAD never confirmed as speech
   * can't contribute a reading.
   */
  private windowedSpeechLoudnessValues(windowStart: number, windowEnd: number, openKind: SegmentKind, openStart: number, openEnd: number): number[] {
    const inSpeech = (t: number): boolean => {
      for (const seg of this.recentSegments) {
        if (seg.kind === 'speech' && t >= seg.start && t < seg.end) return true;
      }
      return openKind === 'speech' && t >= openStart && t < openEnd;
    };
    return this.recentLoudnessSamples.filter((s) => s.time >= windowStart && s.time <= windowEnd && inSpeech(s.time)).map((s) => s.db);
  }

  /**
   * VAD-gated (Part A): null when this window has no VAD-confirmed speech
   * at all, rather than falling back to a background-noise reading or a
   * hardcoded default -- either fallback would report a "loudness" reading
   * that isn't actually the patient speaking, which could also spuriously
   * feed the tone alert during silence. The caller (sessionPipeline.ts)
   * holds the last valid reading forward when this is null, rather than
   * displaying/alerting on a null.
   */
  windowedLoudnessDb(windowStart: number, windowEnd: number, openKind: SegmentKind, openStart: number, openEnd: number): number | null {
    const values = this.windowedSpeechLoudnessValues(windowStart, windowEnd, openKind, openStart, openEnd);
    return values.length ? mean(values) : null;
  }

  windowedLoudnessStdDb(windowStart: number, windowEnd: number, openKind: SegmentKind, openStart: number, openEnd: number): number {
    const values = this.windowedSpeechLoudnessValues(windowStart, windowEnd, openKind, openStart, openEnd);
    return values.length >= 2 ? std(values) : 0;
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

  /**
   * Windowed (trailing analysisWindowSec), not session-cumulative -- this
   * feeds zPause/compositeZ (see classifier.ts), and the personal baseline
   * it's compared against (baselinePauseRatio/-Std) is the mean/std of
   * per-4s-subwindow ratios from calibration (baseline.ts/sessionPipeline's
   * analyzeCalibrationClip). A cumulative-since-session-start ratio drifts
   * further from that per-window baseline the longer a session runs
   * (e.g. speech_seconds_total keeps growing while pause_seconds_total
   * stays flat during a long run of continuous talking) regardless of
   * current speaking behavior, which both false-triggers tachylalia later
   * in a session and -- being monotonic -- can never recover back to
   * NORMAL once it has.
   */
  speechToPauseRatio(windowStart: number, windowEnd: number, openKind: SegmentKind, openStart: number, openEnd: number): number | null {
    const speechSec = this.windowedPhonationSec(windowStart, windowEnd, openKind, openStart, openEnd);
    const pauseSec = this.windowedPauseSec(windowStart, windowEnd, openKind, openStart, openEnd);
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

  // Part C: a near-zero (but nonzero) phonation denominator produced
  // absurd spikes (e.g. 1 syllable / 0.001s phonation = 1000 syll/s) --
  // MIN_LIVE_PHONATION_SEC (well above the old C.EPS floor) is the real
  // fix; ARTICULATION_RATE_MAX_SPS below is the safety-net backstop in
  // case some other path still produces an implausible value.
  const rawArticulationRate = windowedPhonation > C.MIN_LIVE_PHONATION_SEC ? windowedNuclei / windowedPhonation : 0;
  const articulationRate = withinBounds(rawArticulationRate, 0, C.ARTICULATION_RATE_MAX_SPS) ? rawArticulationRate : 0;
  const speechRateSps = effectiveWindow > C.EPS ? windowedNuclei / effectiveWindow : 0;
  const speechRateWpm = (speechRateSps * 60) / C.SYLLABLES_PER_WORD;

  const rawAverageSyllableDuration = windowedNuclei > 0 ? windowedPhonation / windowedNuclei : null;
  const averageSyllableDuration =
    rawAverageSyllableDuration !== null && withinBounds(rawAverageSyllableDuration, C.SYLLABLE_DURATION_MIN_SEC, C.SYLLABLE_DURATION_MAX_SEC)
      ? rawAverageSyllableDuration
      : null;

  const rawInterSyllableIntervalSec = stats.meanIsi();
  const interSyllableIntervalSec =
    rawInterSyllableIntervalSec !== null &&
    withinBounds(rawInterSyllableIntervalSec, C.INTER_SYLLABLE_INTERVAL_MIN_SEC, C.INTER_SYLLABLE_INTERVAL_MAX_SEC)
      ? rawInterSyllableIntervalSec
      : null;

  const voicedF0 = voicedF0Array(pitchFrames);
  const rawMeanPitch = voicedF0.length > 0 ? mean(Array.from(voicedF0)) : null;
  // Safety-net only: pitch.ts's autocorrelation search already can't return
  // f0Hz outside [PITCH_MIN_HZ, PITCH_MAX_HZ] by construction (the lag
  // search range is derived from those same constants), but a "voiced"
  // reading from a bug elsewhere in the chain must still never reach the UI.
  const meanPitch = rawMeanPitch !== null && withinBounds(rawMeanPitch, C.PITCH_MIN_HZ, C.PITCH_MAX_HZ) ? rawMeanPitch : null;
  let pitchVariability: number | null;
  if (meanPitch === null) pitchVariability = null;
  else if (voicedF0.length > 1) pitchVariability = std(Array.from(voicedF0));
  else pitchVariability = 0;

  const rawLoudnessDb = stats.windowedLoudnessDb(windowStart, windowEnd, openKind, openStart, openEnd);
  const loudnessDb =
    rawLoudnessDb !== null && withinBounds(rawLoudnessDb, C.LOUDNESS_REALISTIC_MIN_DBFS, C.LOUDNESS_REALISTIC_MAX_DBFS) ? rawLoudnessDb : null;

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
    interSyllableIntervalSec,
    pauseDurationSec,
    pauseFrequencyPerMin: stats.pauseFrequencyPerMin(elapsedSec),
    pauseCount: stats.totalPauseCount,
    speechToPauseRatio: stats.speechToPauseRatio(windowStart, windowEnd, openKind, openStart, openEnd),
    interPausalUnitLengthSec,
    ipuCount: stats.totalIpuCount + (openSpeechDuration > C.EPS ? 1 : 0),
    speakingDurationSec: stats.totalIpuSec + openSpeechDuration,
    meanPitchHz: meanPitch,
    pitchVariabilityHz: pitchVariability,
    loudnessDb,
    voiceActivityPercent: voiceActivityPct,
    speechConsistency: consistency,
    compositeScore: composite,
    wordsPerLast30Sec: stats.wordsPerLast30Sec(),
    totalSyllablesSession: stats.totalNucleiCount,
    totalWordsSession: stats.totalNucleiCount / C.SYLLABLES_PER_WORD,
    loudnessVariabilityDb: stats.windowedLoudnessStdDb(windowStart, windowEnd, openKind, openStart, openEnd),
  };
}
