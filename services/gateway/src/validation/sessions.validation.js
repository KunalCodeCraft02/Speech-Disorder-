const Joi = require('joi');
const { SESSION_STATUS } = require('../utils/constants');

const objectId = Joi.string().hex().length(24);

const createSession = Joi.object({
  deviceId: objectId.optional(),
});

const sessionIdParam = Joi.object({
  id: objectId.required(),
});

const updateSession = Joi.object({
  notes: Joi.string().trim().max(2000),
  status: Joi.string().valid(SESSION_STATUS.COMPLETED, SESSION_STATUS.ABORTED),
}).min(1);

const listSessions = Joi.object({
  userId: objectId,
  status: Joi.string().valid(...Object.values(SESSION_STATUS)),
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const metricsQuery = Joi.object({
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(1000).default(200),
});

module.exports = { createSession, sessionIdParam, updateSession, listSessions, metricsQuery };
