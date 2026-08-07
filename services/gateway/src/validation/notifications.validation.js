const Joi = require('joi');
const { NOTIFICATION_TYPE, NOTIFICATION_PRIORITY, NOTIFICATION_CHANNEL } = require('../utils/constants');

const objectId = Joi.string().hex().length(24);

const notificationIdParam = Joi.object({
  id: objectId.required(),
});

const listNotifications = Joi.object({
  read: Joi.boolean(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const createNotification = Joi.object({
  userId: objectId.required(),
  type: Joi.string().valid(...Object.values(NOTIFICATION_TYPE)).default(NOTIFICATION_TYPE.CLINICIAN_MESSAGE),
  priority: Joi.string().valid(...Object.values(NOTIFICATION_PRIORITY)),
  channel: Joi.string().valid(...Object.values(NOTIFICATION_CHANNEL)),
  title: Joi.string().trim().min(1).max(150).required(),
  message: Joi.string().trim().min(1).max(1000).required(),
  relatedSessionId: objectId,
  relatedReportId: objectId,
});

module.exports = { notificationIdParam, listNotifications, createNotification };
