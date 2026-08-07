const mongoose = require('mongoose');
const { CLASSIFICATION } = require('../utils/constants');

/**
 * Modeled as a MongoDB time-series collection (timeField: timestamp,
 * metaField: sessionId) — this collection is written to several times a
 * second per active session, and time-series storage keeps that volume
 * cheap to write and cheap to range-query for the dashboard charts.
 */
const speechMetricSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
    timestamp: { type: Date, required: true, default: Date.now },
    elapsedSec: { type: Number },
    articulationRateSPS: { type: Number, required: true },
    speechRateWPM: { type: Number, required: true },
    // Note: the DSP pipeline never actually emits a `pauseRatio` field
    // (only pauseDurationSec/pauseFrequencyPerMin/speechToPauseRatio) —
    // kept here as optional for any caller that still supplies it, but
    // `required` was dropped since insertMetric would otherwise fail
    // validation on literally every real frame.
    pauseRatio: { type: Number, min: 0 },
    pauseFrequencyPerMin: { type: Number },
    speechToPauseRatio: { type: Number },
    meanPitchHz: { type: Number },
    pitchVariabilityHz: { type: Number },
    loudnessDb: { type: Number },
    voiceActivityPercent: { type: Number },
    speechConsistency: { type: Number },
    compositeScore: { type: Number },
    classification: { type: String, enum: Object.values(CLASSIFICATION), required: true },
    confidence: { type: Number, min: 0, max: 1 },

    // Part B.6/B.7/B.9 — decision-audit fields, present on every frame.
    zRate: { type: Number },
    zPause: { type: Number },
    zSyll: { type: Number },
    compositeZ: { type: Number },
    sampleSufficient: { type: Boolean },

    // Part C.10 — new derived parameters.
    wordsPerLast30Sec: { type: Number },
    totalSyllablesSession: { type: Number },
    totalWordsSession: { type: Number },
    rateTrend: { type: Number },
    timeInAbnormalStateSec: { type: Number },
    recoveryTimeSec: { type: Number },
    loudnessVariabilityDb: { type: Number },
    meanPitchTrendHz: { type: Number },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'sessionId',
      granularity: 'seconds',
    },
  }
);

module.exports = mongoose.model('SpeechMetric', speechMetricSchema);
