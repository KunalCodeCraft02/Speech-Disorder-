const mongoose = require('mongoose');
const { FEEDBACK_TYPES, CLASSIFICATION } = require('../utils/constants');

const feedbackEventSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    timestamp: { type: Date, required: true, default: Date.now },
    type: { type: String, enum: Object.values(FEEDBACK_TYPES), default: FEEDBACK_TYPES.VIBRATION },
    reason: {
      type: String,
      enum: [CLASSIFICATION.TACHYLALIA, CLASSIFICATION.BRADYLALIA],
      required: true,
    },
    pattern: { type: [Number], required: true },
    acknowledged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

feedbackEventSchema.index({ sessionId: 1, timestamp: -1 });

module.exports = mongoose.model('FeedbackEvent', feedbackEventSchema);
