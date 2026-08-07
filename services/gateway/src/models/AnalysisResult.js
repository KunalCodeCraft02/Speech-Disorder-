const mongoose = require('mongoose');
const { CLASSIFICATION, ANALYSIS_TYPE, ANALYSIS_STATUS, SEVERITY } = require('../utils/constants');

const classificationBreakdownSchema = new mongoose.Schema(
  {
    normalRatio: { type: Number, min: 0, max: 1, default: 0 },
    tachylaliaRatio: { type: Number, min: 0, max: 1, default: 0 },
    bradylaliaRatio: { type: Number, min: 0, max: 1, default: 0 },
  },
  { _id: false }
);

const baselineComparisonSchema = new mongoose.Schema(
  {
    articulationRateDeltaPercent: { type: Number },
    pauseRatioDeltaPercent: { type: Number },
    speechRateDeltaPercent: { type: Number },
  },
  { _id: false }
);

/**
 * Persisted diagnostic result — one per session (type: session_final),
 * derived once at session end from the SpeechMetric time-series +
 * FeedbackEvent log + the user's calibration Profile. Distinct from the
 * lightweight Session.summary snapshot: this is the clinician/patient-facing
 * analysis, with severity, recommendations and baseline comparison, and
 * exists as its own collection so Reports can reference immutable analysis
 * snapshots instead of re-deriving them.
 */
const analysisResultSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(ANALYSIS_TYPE), default: ANALYSIS_TYPE.SESSION_FINAL },
    status: { type: String, enum: Object.values(ANALYSIS_STATUS), default: ANALYSIS_STATUS.COMPLETED },

    overallClassification: { type: String, enum: Object.values(CLASSIFICATION), required: true },
    severity: { type: String, enum: Object.values(SEVERITY), default: SEVERITY.NONE },
    compositeScore: { type: Number },
    confidence: { type: Number, min: 0, max: 1 },

    classificationBreakdown: { type: classificationBreakdownSchema, default: () => ({}) },

    avgArticulationRateSPS: { type: Number, min: 0 },
    avgSpeechRateWPM: { type: Number, min: 0 },
    avgPauseRatio: { type: Number, min: 0, max: 1 },
    avgPitchHz: { type: Number, min: 0 },
    avgLoudnessDb: { type: Number },
    voiceActivityPercent: { type: Number, min: 0, max: 100 },
    speechConsistency: { type: Number },

    tachylaliaEvents: { type: Number, default: 0, min: 0 },
    bradylaliaEvents: { type: Number, default: 0, min: 0 },

    baselineComparison: { type: baselineComparisonSchema, default: () => ({}) },
    recommendations: { type: [String], default: [] },
    notes: { type: String, maxlength: 2000 },

    generatedBy: { type: String, enum: ['system', 'clinician'], default: 'system' },
    generatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// At most one `session_final` result per session; realtime/periodic results are unbounded.
analysisResultSchema.index(
  { sessionId: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: ANALYSIS_TYPE.SESSION_FINAL } }
);
analysisResultSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AnalysisResult', analysisResultSchema);
