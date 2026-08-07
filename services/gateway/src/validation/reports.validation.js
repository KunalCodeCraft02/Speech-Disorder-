const Joi = require('joi');
const { REPORT_TYPE, REPORT_STATUS, REPORT_FORMAT } = require('../utils/constants');

const objectId = Joi.string().hex().length(24);

const reportIdParam = Joi.object({
  id: objectId.required(),
});

const sessionIdParam = Joi.object({
  sessionId: objectId.required(),
});

const listReports = Joi.object({
  userId: objectId,
  authorId: objectId,
  sessionId: objectId,
  status: Joi.string().valid(...Object.values(REPORT_STATUS)),
  type: Joi.string().valid(...Object.values(REPORT_TYPE)),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const createReport = Joi.object({
  userId: objectId.required(),
  title: Joi.string().trim().min(1).max(200).required(),
  type: Joi.string().valid(...Object.values(REPORT_TYPE)),
  format: Joi.string().valid(...Object.values(REPORT_FORMAT)),
  sessionIds: Joi.array().items(objectId).max(200),
  analysisResultIds: Joi.array().items(objectId).max(200),
  periodStart: Joi.date().iso(),
  periodEnd: Joi.date().iso(),
  summary: Joi.string().trim().max(5000),
}).custom((value, helpers) => {
  if (value.periodStart && value.periodEnd && new Date(value.periodStart) > new Date(value.periodEnd)) {
    return helpers.message('periodStart must be before periodEnd');
  }
  return value;
});

const updateReport = Joi.object({
  title: Joi.string().trim().min(1).max(200),
  status: Joi.string().valid(...Object.values(REPORT_STATUS)),
  format: Joi.string().valid(...Object.values(REPORT_FORMAT)),
  sessionIds: Joi.array().items(objectId).max(200),
  analysisResultIds: Joi.array().items(objectId).max(200),
  periodStart: Joi.date().iso(),
  periodEnd: Joi.date().iso(),
  summary: Joi.string().trim().max(5000),
}).min(1);

const shareReport = Joi.object({
  userId: objectId.required(),
});

const generateForSession = Joi.object({
  title: Joi.string().trim().min(1).max(200),
});

module.exports = {
  reportIdParam,
  sessionIdParam,
  listReports,
  createReport,
  updateReport,
  shareReport,
  generateForSession,
};
