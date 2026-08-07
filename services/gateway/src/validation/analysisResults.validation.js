const Joi = require('joi');
const { CLASSIFICATION, ANALYSIS_TYPE, SEVERITY } = require('../utils/constants');

const objectId = Joi.string().hex().length(24);

const analysisResultIdParam = Joi.object({
  id: objectId.required(),
});

const listAnalysisResults = Joi.object({
  userId: objectId,
  sessionId: objectId,
  type: Joi.string().valid(...Object.values(ANALYSIS_TYPE)),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const createAnalysisResult = Joi.object({
  sessionId: objectId.required(),
  type: Joi.string().valid(...Object.values(ANALYSIS_TYPE)),
  overallClassification: Joi.string().valid(...Object.values(CLASSIFICATION)).required(),
  severity: Joi.string().valid(...Object.values(SEVERITY)),
  compositeScore: Joi.number(),
  confidence: Joi.number().min(0).max(1),
  avgArticulationRateSPS: Joi.number().min(0),
  avgSpeechRateWPM: Joi.number().min(0),
  avgPauseRatio: Joi.number().min(0).max(1),
  avgPitchHz: Joi.number().min(0),
  avgLoudnessDb: Joi.number(),
  voiceActivityPercent: Joi.number().min(0).max(100),
  speechConsistency: Joi.number(),
  tachylaliaEvents: Joi.number().integer().min(0),
  bradylaliaEvents: Joi.number().integer().min(0),
  recommendations: Joi.array().items(Joi.string().max(500)),
  notes: Joi.string().trim().max(2000),
});

module.exports = { analysisResultIdParam, listAnalysisResults, createAnalysisResult };
