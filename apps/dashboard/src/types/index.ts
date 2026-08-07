// Mirrors services/gateway's wire contracts exactly:
//   - constants.js CLASSIFICATION / SESSION_STATUS / SOCKET_EVENTS
//   - models/{Session,SpeechMetric,FeedbackEvent,Profile,User}.js
//   - sockets/index.js wireSessionManagerBroadcasts() metrics:update payload

export type Role = 'patient' | 'clinician' | 'admin';

export type SessionStatus = 'active' | 'completed' | 'aborted';

export type Classification = 'uncalibrated' | 'normal' | 'tachylalia' | 'bradylalia';

// Session-level selection (set once at session start, from the phone's
// landing page) — distinct from the per-frame `classification` above.
export type DisorderMode = 'tachylalia' | 'bradylalia';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface SessionSummary {
  durationSec: number;
  avgArticulationRateSPS: number | null;
  avgSpeechRateWPM: number | null;
  avgPauseRatio: number | null;
  tachylaliaEvents: number;
  bradylaliaEvents: number;
  normalRatio: number | null;
}

export interface Session {
  _id: string;
  userId: string;
  deviceId?: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  notes?: string;
  summary: SessionSummary;
  createdAt: string;
  updatedAt: string;
}

// One `metrics:update` event on the /dashboard namespace (dashboard.handler.js).
export interface MetricsFrame {
  sessionId: string;
  ts: string;
  elapsedSec: number | null;
  articulationRateSPS: number;
  speechRateWPM: number;
  pauseRatio: number;
  pauseFrequencyPerMin: number | null;
  speechToPauseRatio: number | null;
  averageSyllableDurationSec: number | null;
  interSyllableIntervalSec: number | null;
  pauseDurationSec: number | null;
  interPausalUnitLengthSec: number | null;
  meanPitchHz: number | null;
  pitchVariabilityHz: number | null;
  loudnessDb: number | null;
  voiceActivityPercent: number | null;
  speechConsistency: number | null;
  compositeScore: number | null;
  classification: Classification;
  confidence: number | null;
  triggerFeedback: boolean;
  feedbackReason: Classification | null;
  // Part B.6/B.7/B.9 — decision-audit fields, present on every frame.
  zRate: number | null;
  zPause: number | null;
  zSyll: number | null;
  compositeZ: number | null;
  sampleSufficient: boolean | null;
  // Part C.10 — new derived parameters.
  wordsPerLast30Sec: number | null;
  totalSyllablesSession: number | null;
  totalWordsSession: number | null;
  rateTrend: number | null;
  timeInAbnormalStateSec: number | null;
  recoveryTimeSec: number | null;
  loudnessVariabilityDb: number | null;
  meanPitchTrendHz: number | null;
}

// A persisted SpeechMetric document, as returned by GET /sessions/:id/metrics.
export interface SpeechMetricDoc {
  _id: string;
  sessionId: string;
  timestamp: string;
  elapsedSec: number | null;
  articulationRateSPS: number;
  speechRateWPM: number;
  pauseRatio: number;
  pauseFrequencyPerMin: number | null;
  speechToPauseRatio: number | null;
  meanPitchHz: number | null;
  pitchVariabilityHz: number | null;
  loudnessDb: number | null;
  voiceActivityPercent: number | null;
  speechConsistency: number | null;
  compositeScore: number | null;
  classification: Classification;
  confidence: number | null;
  zRate: number | null;
  zPause: number | null;
  zSyll: number | null;
  compositeZ: number | null;
  sampleSufficient: boolean | null;
  wordsPerLast30Sec: number | null;
  totalSyllablesSession: number | null;
  totalWordsSession: number | null;
  rateTrend: number | null;
  timeInAbnormalStateSec: number | null;
  recoveryTimeSec: number | null;
  loudnessVariabilityDb: number | null;
  meanPitchTrendHz: number | null;
}

export interface FeedbackEvent {
  _id: string;
  sessionId: string;
  timestamp: string;
  type: 'vibration';
  reason: 'tachylalia' | 'bradylalia';
  pattern: number[];
  acknowledged: boolean;
}

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
  // True only when this baseline carries a real per-patient std (drives
  // the z-score classification method) — sessions without one are
  // lower-confidence, fixed-multiplier-fallback sessions (Part A.1/B.5).
  isPersonal: boolean | null;
  tachylaliaThreshold: number | null;
  bradylaliaThreshold: number | null;
  // Descriptive baseline snapshot from the calibration reading(s) — see
  // services/dsp-service's CalibrationResponse and services/gateway's
  // Profile model, which these mirror.
  baselineSpeechRateWPM: number | null;
  baselinePitchHz: number | null;
  baselineLoudnessDb: number | null;
  baselinePauseDurationSec: number | null;
  baselineSpeechRatio: number | null;
  calibrationDurationSec: number | null;
  calibrationSyllableCount: number | null;
  calibratedAt: string | null;
}

export type ReportStatus = 'draft' | 'finalized' | 'archived';

// Metadata for a generated PDF report (services/gateway's Report model,
// minus the `pdf.data` binary — see GET /reports and POST
// /reports/sessions/:sessionId/generate). The actual bytes are only ever
// fetched via GET /reports/:id/download.
export interface Report {
  _id: string;
  userId: string;
  authorId: string;
  title: string;
  type: 'session' | 'progress' | 'calibration';
  status: ReportStatus;
  sessionIds: string[];
  analysisResultIds: string[];
  summary?: string;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface SessionStartedEvent {
  sessionId: string;
  userId: string;
  startedAt: string;
  disorderMode: DisorderMode;
  demoMode: boolean;
}

export interface SessionEndedEvent {
  sessionId: string;
  summary: SessionSummary;
}

export interface FeedbackLoggedEvent {
  sessionId: string;
  reason: 'tachylalia' | 'bradylalia';
  pattern: number[];
  ts: string;
}

export interface SocketErrorEvent {
  code: string;
  message: string;
}
