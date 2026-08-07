const mongoose = require('mongoose');
const { SESSION_STATUS, DISORDER_MODE } = require('../utils/constants');

const summarySchema = new mongoose.Schema(
  {
    durationSec: { type: Number, default: 0 },
    avgArticulationRateSPS: { type: Number },
    avgSpeechRateWPM: { type: Number },
    avgPauseRatio: { type: Number },
    tachylaliaEvents: { type: Number, default: 0 },
    bradylaliaEvents: { type: Number, default: 0 },
    normalRatio: { type: Number }, // fraction of windows classified normal
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
    // Set once at session start from the phone's landing page (Part D) and
    // never changed afterward -- scopes the classifier to a single
    // disorder direction for the session's whole lifetime (Part B.8).
    disorderMode: { type: String, enum: Object.values(DISORDER_MODE), required: true, default: DISORDER_MODE.TACHYLALIA },
    // Permits the population-default baseline fallback when the patient
    // has no calibration (Part A.1) -- must never be true for a real
    // patient session.
    demoMode: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(SESSION_STATUS),
      default: SESSION_STATUS.ACTIVE,
      index: true,
    },
    startedAt: { type: Date, required: true, default: Date.now },
    endedAt: { type: Date },
    notes: { type: String, maxlength: 2000 },
    summary: { type: summarySchema, default: () => ({}) },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, startedAt: -1 });

module.exports = mongoose.model('Session', sessionSchema);
