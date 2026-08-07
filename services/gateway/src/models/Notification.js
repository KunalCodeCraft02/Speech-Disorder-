const mongoose = require('mongoose');
const { NOTIFICATION_TYPE, NOTIFICATION_PRIORITY, NOTIFICATION_CHANNEL } = require('../utils/constants');

/**
 * User-facing alert/inbox item. Created either by the system (session
 * completion, report finalization) or by a clinician/admin (a direct
 * message). `expiresAt` is optional and, when set, backs a TTL index so
 * transient alerts (e.g. reminders) don't accumulate forever.
 */
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPE), required: true },
    priority: { type: String, enum: Object.values(NOTIFICATION_PRIORITY), default: NOTIFICATION_PRIORITY.NORMAL },
    channel: { type: String, enum: Object.values(NOTIFICATION_CHANNEL), default: NOTIFICATION_CHANNEL.IN_APP },

    title: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },

    relatedSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
    relatedReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report' },

    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },

    expiresAt: { type: Date },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Notification', notificationSchema);
