const mongoose = require('mongoose');

// One calibration attempt's full result. Appended to `calibrationHistory`
// on every (re)calibration -- never overwritten in place, mirroring the
// append-only idiom already used by User.refreshTokens -- so recalibrating
// never silently destroys a patient's prior baseline history.
const calibrationSnapshotSchema = new mongoose.Schema(
  {
    // Classifier baseline — drives real-time Tachylalia/Bradylalia
    // detection (mirrors dsp-service's CalibrationResponse field-for-field).
    baselineArticulationRate: { type: Number, min: 0 },
    baselineArticulationRateStd: { type: Number, min: 0 },
    baselinePauseRatio: { type: Number, min: 0 },
    baselinePauseRatioStd: { type: Number, min: 0 },
    baselineSyllableDurationSec: { type: Number, min: 0 },
    baselineSyllableDurationStd: { type: Number, min: 0 },
    baselineIpuLengthSec: { type: Number, min: 0 },
    baselineIpuLengthStd: { type: Number, min: 0 },
    // True only when this snapshot carries a real per-patient std -- gates
    // the z-score classification method vs. the fixed-multiplier fallback.
    isPersonal: { type: Boolean, default: false },
    tachylaliaThreshold: { type: Number, min: 0 },
    bradylaliaThreshold: { type: Number, min: 0 },

    // Descriptive snapshot — for display and session-to-session
    // comparison, not consumed by the classifier.
    baselineSpeechRateWPM: { type: Number, min: 0 },
    baselinePitchHz: { type: Number, min: 0 },
    baselineLoudnessDb: { type: Number },
    baselinePauseDurationSec: { type: Number, min: 0 },
    baselineSpeechRatio: { type: Number, min: 0, max: 1 },

    calibrationDurationSec: { type: Number, min: 0 },
    calibrationSyllableCount: { type: Number, min: 0 },
    clipCount: { type: Number, min: 0, default: 0 },
    source: { type: String, enum: ['record', 'manual'], default: 'record' },
    calibratedAt: { type: Date, default: Date.now },
  },
  { _id: true, timestamps: false }
);

const profileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    // "Active" calibration -- a flat copy of the most recent
    // calibrationHistory entry, kept at the top level so callers that only
    // need the current baseline (e.g. session.handler.js's
    // loadCalibration) don't need to know calibrationHistory exists. Only
    // ever set by userService from the latest history entry -- never
    // written to directly.
    baselineArticulationRate: { type: Number, min: 0 },
    baselineArticulationRateStd: { type: Number, min: 0 },
    baselinePauseRatio: { type: Number, min: 0 },
    baselinePauseRatioStd: { type: Number, min: 0 },
    baselineSyllableDurationSec: { type: Number, min: 0 },
    baselineSyllableDurationStd: { type: Number, min: 0 },
    baselineIpuLengthSec: { type: Number, min: 0 },
    baselineIpuLengthStd: { type: Number, min: 0 },
    isPersonal: { type: Boolean, default: false },
    tachylaliaThreshold: { type: Number, min: 0 },
    bradylaliaThreshold: { type: Number, min: 0 },

    baselineSpeechRateWPM: { type: Number, min: 0 },
    baselinePitchHz: { type: Number, min: 0 },
    baselineLoudnessDb: { type: Number },
    baselinePauseDurationSec: { type: Number, min: 0 },
    baselineSpeechRatio: { type: Number, min: 0, max: 1 },

    calibrationDurationSec: { type: Number, min: 0 },
    calibrationSyllableCount: { type: Number, min: 0 },
    calibratedAt: { type: Date },

    // Append-only calibration history (Part A.4) -- recalibrating always
    // pushes a new snapshot rather than overwriting.
    calibrationHistory: { type: [calibrationSnapshotSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Profile', profileSchema);
