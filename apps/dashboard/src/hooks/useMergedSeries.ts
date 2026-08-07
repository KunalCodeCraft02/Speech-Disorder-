import { useMemo } from 'react';
import type { MetricsFrame, SpeechMetricDoc } from '../types';

export interface SeriesPoint {
  ts: number;
  elapsedSec: number | null;
  articulationRateSPS: number;
  speechRateWPM: number;
  pauseRatio: number;
  pauseFrequencyPerMin: number | null;
  meanPitchHz: number | null;
  pitchVariabilityHz: number | null;
  loudnessDb: number | null;
  voiceActivityPercent: number | null;
  compositeScore: number | null;
  wordsPerLast30Sec: number | null;
  compositeZ: number | null;
  loudnessVariabilityDb: number | null;
}

const MAX_POINTS = 240;

function fromDoc(doc: SpeechMetricDoc): SeriesPoint {
  return {
    ts: new Date(doc.timestamp).getTime(),
    elapsedSec: doc.elapsedSec,
    articulationRateSPS: doc.articulationRateSPS,
    speechRateWPM: doc.speechRateWPM,
    pauseRatio: doc.pauseRatio,
    pauseFrequencyPerMin: doc.pauseFrequencyPerMin,
    meanPitchHz: doc.meanPitchHz,
    pitchVariabilityHz: doc.pitchVariabilityHz,
    loudnessDb: doc.loudnessDb,
    voiceActivityPercent: doc.voiceActivityPercent,
    compositeScore: doc.compositeScore,
    wordsPerLast30Sec: doc.wordsPerLast30Sec,
    compositeZ: doc.compositeZ,
    loudnessVariabilityDb: doc.loudnessVariabilityDb,
  };
}

function fromFrame(frame: MetricsFrame): SeriesPoint {
  return {
    ts: new Date(frame.ts).getTime(),
    elapsedSec: frame.elapsedSec,
    articulationRateSPS: frame.articulationRateSPS,
    speechRateWPM: frame.speechRateWPM,
    pauseRatio: frame.pauseRatio,
    pauseFrequencyPerMin: frame.pauseFrequencyPerMin,
    meanPitchHz: frame.meanPitchHz,
    pitchVariabilityHz: frame.pitchVariabilityHz,
    loudnessDb: frame.loudnessDb,
    voiceActivityPercent: frame.voiceActivityPercent,
    compositeScore: frame.compositeScore,
    wordsPerLast30Sec: frame.wordsPerLast30Sec,
    compositeZ: frame.compositeZ,
    loudnessVariabilityDb: frame.loudnessVariabilityDb,
  };
}

/** Historical backfill (older) followed by the live rolling buffer (newest), capped for chart perf. */
export function useMergedSeries(backfill: SpeechMetricDoc[] | undefined, live: MetricsFrame[]): SeriesPoint[] {
  return useMemo(() => {
    const earliestLiveTs = live.length ? new Date(live[0].ts).getTime() : Infinity;
    const historical = (backfill ?? []).map(fromDoc).filter((p) => p.ts < earliestLiveTs);
    const merged = [...historical, ...live.map(fromFrame)];
    return merged.length > MAX_POINTS ? merged.slice(merged.length - MAX_POINTS) : merged;
  }, [backfill, live]);
}
