// Local equivalent of the DSP service's POST /calibrate — pools the 2
// recorded clips' calibration-subwindow samples into one personal
// baseline, entirely on-device. Mirrors
// services/dsp-service/app/api/routes.py's `calibrate()` (Part A of the
// classification engine spec), minus everything that only made sense over
// a network boundary (bearer auth, JSON payload shaping).

import { baselineFromSubwindowSamples } from '../dsp/baseline';
import { settings } from '../dsp/config';
import { analyzeCalibrationClip, type CalibrationClipResult } from '../dsp/sessionPipeline';
import { getCalibration, saveCalibration, type CalibrationRecord } from '../storage/calibration';

export class CalibrationError extends Error {}

function weightedMean(clipResults: CalibrationClipResult[], key: keyof CalibrationClipResult['descriptive']): number | null {
  const pairs = clipResults
    .map((c) => [c.descriptive[key], c.durationSec] as const)
    .filter(([v]) => v !== null && v !== undefined) as Array<readonly [number, number]>;
  const totalWeight = pairs.reduce((sum, [, w]) => sum + w, 0);
  if (pairs.length === 0 || totalWeight <= 0) return null;
  return pairs.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight;
}

/**
 * Runs each recorded clip through the calibration-clip analysis, pools
 * every clip's sub-window samples (Part A.4: 2 short clips beat one longer
 * one), rejects the attempt if pooled phonation time is too short (Part
 * A.3), and persists the resulting baseline locally for `userId` --
 * replacing that user's previous calibration (if any) as their active one.
 * Nothing is written until this whole pass succeeds, so a failed or
 * cancelled attempt never touches the user's existing calibration.
 */
export async function runCalibration(userId: string, clips: Array<{ samples: Float32Array; sampleRate: number }>): Promise<CalibrationRecord> {
  if (clips.length === 0) {
    throw new CalibrationError('Calibration requires at least one recorded clip.');
  }

  const clipResults = clips.map((clip) => analyzeCalibrationClip(clip.samples, clip.sampleRate, settings));

  const totalPhonation = clipResults.reduce((sum, c) => sum + c.phonationSec, 0);
  if (totalPhonation < settings.minCalibrationPhonationSec) {
    throw new CalibrationError(
      `Only ${totalPhonation.toFixed(1)}s of actual speech detected across ${clipResults.length} clip(s); ` +
        `${settings.minCalibrationPhonationSec.toFixed(0)}s of phonation is required. Please redo calibration and try to speak continuously through the passage.`
    );
  }

  const rateSamples = clipResults.flatMap((c) => c.rateSamples);
  const pauseSamples = clipResults.flatMap((c) => c.pauseSamples);
  const syllSamples = clipResults.flatMap((c) => c.syllableDurationSamples);
  const ipuSamples = clipResults.flatMap((c) => c.ipuLengthSamples);

  const previous = await getCalibration(userId);
  const baseline = baselineFromSubwindowSamples(rateSamples, pauseSamples, syllSamples, ipuSamples, settings, {
    interSyllableIntervalSamples: clipResults.flatMap((c) => c.interSyllableIntervalSamples),
    pauseDurationSamples: clipResults.flatMap((c) => c.pauseDurationSamples),
    pauseFrequencySamples: clipResults.flatMap((c) => c.pauseFrequencySamples),
    meanPitchSamples: clipResults.flatMap((c) => c.meanPitchSamples),
    loudnessSamples: clipResults.flatMap((c) => c.loudnessSamples),
    voiceActivitySamples: clipResults.flatMap((c) => c.voiceActivitySamples),
  });

  const now = new Date().toISOString();
  const record: CalibrationRecord = {
    ...baseline,
    userId,
    baselineSpeechRateWPM: weightedMean(clipResults, 'speechRateWPM'),
    baselineSpeechRatio: weightedMean(clipResults, 'speechRatio'),
    durationSec: Math.round(clipResults.reduce((sum, c) => sum + c.durationSec, 0) * 100) / 100,
    syllableCount: clipResults.reduce((sum, c) => sum + c.syllableCount, 0),
    clipCount: clipResults.length,
    status: 'completed',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    version: (previous?.version ?? 0) + 1,
  };

  await saveCalibration(userId, record);
  return record;
}
