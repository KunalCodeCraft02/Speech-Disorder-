const mongoose = require('mongoose');
const { DEVICE_TYPES } = require('../utils/constants');

const deviceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(DEVICE_TYPES), required: true },
    label: { type: String, trim: true, maxlength: 80 },
    pushToken: { type: String },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

deviceSchema.index({ userId: 1, type: 1 });

module.exports = mongoose.model('Device', deviceSchema);
