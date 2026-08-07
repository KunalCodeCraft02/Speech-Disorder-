const AnalysisResult = require('../models/AnalysisResult');
const Session = require('../models/Session');
const SpeechMetric = require('../models/SpeechMetric');
const FeedbackEvent = require('../models/FeedbackEvent');
const Profile = require('../models/Profile');
const ApiError = require('../utils/ApiError');
const { ROLES, CLASSIFICATION, ANALYSIS_TYPE, SEVERITY } = require('../utils/constants');

function percentDelta(actual, baseline) {
  if (actual == null || baseline == null || baseline === 0) return null;
  return ((actual - baseline) / baseline) * 100;
}

function severityFromEventRatio(tachylaliaEvents, bradylaliaEvents, totalWindows) {
  if (!totalWindows) return SEVERITY.NONE;
  const disruptedRatio = (tachylaliaEvents + bradylaliaEvents) / totalWindows;
  if (disruptedRatio === 0) return SEVERITY.NONE;
  if (disruptedRatio < 0.15) return SEVERITY.MILD;
  if (disruptedRatio < 0.4) return SEVERITY.MODERATE;
  return SEVERITY.SEVERE;
}

function buildRecommendations(overallClassification, severity) {
  if (overallClassification === CLASSIFICATION.NORMAL) {
    return ['Speech patterns are within the calibrated normal range. No action needed.'];
  }

  const recommendations = [];
  if (overallClassification === CLASSIFICATION.TACHYLALIA) {
    recommendations.push('Practice deliberate pausing between phrases to reduce articulation rate.');
  }
  if (overallClassification === CLASSIFICATION.BRADYLALIA) {
    recommendations.push('Practice sustained phonation exercises to build speech rate and fluency.');
  }
  if (severity === SEVERITY.MODERATE || severity === SEVERITY.SEVERE) {
    recommendations.push('Consider scheduling a follow-up with your clinician to review this session.');
  }
  return recommendations;
}

/**
 * Builds and persists the `session_final` AnalysisResult for a just-ended
 * session, aggregating its SpeechMetric time-series + FeedbackEvent log and
 * comparing against the user's calibration Profile. Idempotent — re-running
 * replaces the existing session_final result for this session.
 */
async function generateFinalResult(sessionId) {
  const session = await Session.findById(sessionId);
  if (!session) throw ApiError.notFound('Session not found');

  const [agg] = await SpeechMetric.aggregate([
    { $match: { sessionId: session._id } },
    {
      $group: {
        _id: null,
        avgArticulationRateSPS: { $avg: '$articulationRateSPS' },
        avgSpeechRateWPM: { $avg: '$speechRateWPM' },
        avgPauseRatio: { $avg: '$pauseRatio' },
        avgPitchHz: { $avg: '$meanPitchHz' },
        avgLoudnessDb: { $avg: '$loudnessDb' },
        avgVoiceActivityPercent: { $avg: '$voiceActivityPercent' },
        avgSpeechConsistency: { $avg: '$speechConsistency' },
        avgCompositeScore: { $avg: '$compositeScore' },
        avgConfidence: { $avg: '$confidence' },
        total: { $sum: 1 },
        normalCount: { $sum: { $cond: [{ $eq: ['$classification', CLASSIFICATION.NORMAL] }, 1, 0] } },
        tachylaliaCount: { $sum: { $cond: [{ $eq: ['$classification', CLASSIFICATION.TACHYLALIA] }, 1, 0] } },
        bradylaliaCount: { $sum: { $cond: [{ $eq: ['$classification', CLASSIFICATION.BRADYLALIA] }, 1, 0] } },
      },
    },
  ]);

  const [tachylaliaEvents, bradylaliaEvents] = await Promise.all([
    FeedbackEvent.countDocuments({ sessionId, reason: CLASSIFICATION.TACHYLALIA }),
    FeedbackEvent.countDocuments({ sessionId, reason: CLASSIFICATION.BRADYLALIA }),
  ]);

  const total = agg?.total || 0;
  const counts = {
    [CLASSIFICATION.NORMAL]: agg?.normalCount || 0,
    [CLASSIFICATION.TACHYLALIA]: agg?.tachylaliaCount || 0,
    [CLASSIFICATION.BRADYLALIA]: agg?.bradylaliaCount || 0,
  };
  const overallClassification =
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || CLASSIFICATION.NORMAL;
  const severity = severityFromEventRatio(tachylaliaEvents, bradylaliaEvents, total);

  const profile = await Profile.findOne({ userId: session.userId });
  const baselineComparison = {
    articulationRateDeltaPercent: percentDelta(agg?.avgArticulationRateSPS, profile?.baselineArticulationRate),
    pauseRatioDeltaPercent: percentDelta(agg?.avgPauseRatio, profile?.baselinePauseRatio),
    speechRateDeltaPercent: percentDelta(agg?.avgSpeechRateWPM, profile?.baselineSpeechRateWPM),
  };

  const doc = {
    sessionId: session._id,
    userId: session.userId,
    type: ANALYSIS_TYPE.SESSION_FINAL,
    overallClassification,
    severity,
    compositeScore: agg?.avgCompositeScore ?? null,
    confidence: agg?.avgConfidence ?? null,
    classificationBreakdown: {
      normalRatio: total ? counts[CLASSIFICATION.NORMAL] / total : 0,
      tachylaliaRatio: total ? counts[CLASSIFICATION.TACHYLALIA] / total : 0,
      bradylaliaRatio: total ? counts[CLASSIFICATION.BRADYLALIA] / total : 0,
    },
    avgArticulationRateSPS: agg?.avgArticulationRateSPS ?? null,
    avgSpeechRateWPM: agg?.avgSpeechRateWPM ?? null,
    avgPauseRatio: agg?.avgPauseRatio ?? null,
    avgPitchHz: agg?.avgPitchHz ?? null,
    avgLoudnessDb: agg?.avgLoudnessDb ?? null,
    voiceActivityPercent: agg?.avgVoiceActivityPercent ?? null,
    speechConsistency: agg?.avgSpeechConsistency ?? null,
    tachylaliaEvents,
    bradylaliaEvents,
    baselineComparison,
    recommendations: buildRecommendations(overallClassification, severity),
    generatedBy: 'system',
  };

  return AnalysisResult.findOneAndUpdate(
    { sessionId: session._id, type: ANALYSIS_TYPE.SESSION_FINAL },
    doc,
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
}

async function getByIdOr404(id) {
  const result = await AnalysisResult.findById(id);
  if (!result) throw ApiError.notFound('Analysis result not found');
  return result;
}

/** Throws 403 unless the requester owns the underlying session or is a clinician/admin. */
function assertCanAccess(result, requester) {
  const isOwner = result.userId.toString() === requester.id;
  const isPrivileged = requester.role === ROLES.CLINICIAN || requester.role === ROLES.ADMIN;
  if (!isOwner && !isPrivileged) {
    throw ApiError.forbidden('You do not have access to this analysis result');
  }
}

async function listResults({ userId, sessionId, type, page, limit }) {
  const filter = {};
  if (userId) filter.userId = userId;
  if (sessionId) filter.sessionId = sessionId;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    AnalysisResult.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    AnalysisResult.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

/** Clinician/admin-authored analysis result, e.g. a manual override or a note-only review. */
async function createManual(sessionId, data, author) {
  const session = await Session.findById(sessionId);
  if (!session) throw ApiError.notFound('Session not found');

  return AnalysisResult.create({
    ...data,
    sessionId: session._id,
    userId: session.userId,
    generatedBy: 'clinician',
    generatedByUserId: author.id,
  });
}

async function deleteResult(id) {
  const result = await getByIdOr404(id);
  await result.deleteOne();
}

module.exports = {
  generateFinalResult,
  getByIdOr404,
  assertCanAccess,
  listResults,
  createManual,
  deleteResult,
};
