// Mirrors services/gateway's wire contracts — see that service's
// src/utils/constants.js SOCKET_EVENTS and the /device + /dashboard
// namespace handlers.

export type Role = 'patient' | 'clinician' | 'admin';
export type Classification = 'uncalibrated' | 'normal' | 'tachylalia' | 'bradylalia';

// Session-level selection (set once, from the landing page before Live
// Session) — distinct from the per-frame `classification` above.
export type DisorderMode = 'tachylalia' | 'bradylalia';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

// device namespace — server -> phone
export interface SessionAck {
  sessionId: string;
  startedAt: string;
  disorderMode?: DisorderMode;
  demoMode?: boolean;
  calibrated?: boolean;
}

export interface SessionStopAck {
  sessionId: string;
  summary?: unknown;
}

export interface VibrationCommand {
  pattern: number[];
  reason: 'tachylalia' | 'bradylalia';
}

export interface DeviceErrorEvent {
  code: string;
  message: string;
}

// dashboard namespace — server -> dashboard (self-subscribed). Widened to
// the full metrics:update payload (Part F: phone shows the same primary/
// secondary parameter set as the dashboard) — previously only
// classification/confidence were read here.
export interface MetricsUpdateEvent {
  sessionId: string;
  ts?: string;
  elapsedSec: number | null;
  articulationRateSPS?: number;
  speechRateWPM?: number;
  pauseRatio?: number;
  pauseFrequencyPerMin?: number | null;
  speechToPauseRatio?: number | null;
  averageSyllableDurationSec?: number | null;
  interSyllableIntervalSec?: number | null;
  pauseDurationSec?: number | null;
  interPausalUnitLengthSec?: number | null;
  meanPitchHz?: number | null;
  pitchVariabilityHz?: number | null;
  loudnessDb?: number | null;
  voiceActivityPercent?: number | null;
  compositeScore?: number | null;
  classification: Classification;
  confidence: number | null;
  triggerFeedback?: boolean;
  feedbackReason?: Classification | null;
  zRate?: number | null;
  zPause?: number | null;
  zSyll?: number | null;
  compositeZ?: number | null;
  sampleSufficient?: boolean | null;
  wordsPerLast30Sec?: number | null;
  totalSyllablesSession?: number | null;
  totalWordsSession?: number | null;
  rateTrend?: number | null;
  timeInAbnormalStateSec?: number | null;
  recoveryTimeSec?: number | null;
  loudnessVariabilityDb?: number | null;
  meanPitchTrendHz?: number | null;
}

// Mirrors services/gateway's Profile model / dsp-service's
// CalibrationResponse — POST /users/:id/calibration/record returns this.
export interface CalibrationProfile {
  userId: string;
  baselineArticulationRate: number | null;
  baselineArticulationRateStd: number | null;
  baselinePauseRatio: number | null;
  baselinePauseRatioStd: number | null;
  baselineSyllableDurationSec: number | null;
  baselineSyllableDurationStd: number | null;
  baselineIpuLengthSec: number | null;
  baselineIpuLengthStd: number | null;
  isPersonal: boolean | null;
  tachylaliaThreshold: number | null;
  bradylaliaThreshold: number | null;
  baselineSpeechRateWPM: number | null;
  baselinePitchHz: number | null;
  baselineLoudnessDb: number | null;
  baselinePauseDurationSec: number | null;
  baselineSpeechRatio: number | null;
  calibrationDurationSec: number | null;
  calibrationSyllableCount: number | null;
  calibratedAt: string | null;
}

export interface CalibrationClipUpload {
  audioBase64: string;
  sampleRate: number;
}
