const Session = require('../models/Session');
const SpeechMetric = require('../models/SpeechMetric');
const FeedbackEvent = require('../models/FeedbackEvent');
const ApiError = require('../utils/ApiError');
const analysisResultService = require('./analysisResultService');
const notificationService = require('./notificationService');
const reportService = require('./reportService');
const logger = require('../config/logger');
const { SESSION_STATUS, CLASSIFICATION, NOTIFICATION_TYPE } = require('../utils/constants');

/**
 * Marks any session still `status: 'active'` in the DB as `aborted`. Meant
 * to run once at process startup, before the socket server starts
 * accepting connections: `sessionManager`'s in-memory session map always
 * starts empty on a fresh boot, so any session still `active` in the
 * database at that point is provably orphaned -- its owning process died
 * (crash, forced kill, deploy) without ever reaching the normal
 * disconnect/session:stop cleanup path that would have closed it out.
 * Left alone, an orphaned session is a live-view dead end: the dashboard's
 * "most recent active session" query keeps finding it and waiting forever
 * for metrics a device will never send again.
 */
async function reapOrphanedActiveSessions() {
  const res = await Session.updateMany(
    { status: SESSION_STATUS.ACTIVE },
    { $set: { status: SESSION_STATUS.ABORTED, endedAt: new Date() } }
  );
  if (res.modifiedCount > 0) {
    logger.warn('Reaped orphaned active session(s) left over from a previous process', { count: res.modifiedCount });
  }
  return res.modifiedCount;
}

async function createSession(userId, deviceId, { disorderMode, demoMode } = {}) {
  return Session.create({
    userId,
    deviceId,
    startedAt: new Date(),
    status: SESSION_STATUS.ACTIVE,
    ...(disorderMode ? { disorderMode } : {}),
    demoMode: Boolean(demoMode),
  });
}

async function getSessionOr404(sessionId) {
  const session = await Session.findById(sessionId);
  if (!session) throw ApiError.notFound('Session not found');
  return session;
}

/** Throws 403 unless the requester owns the session or is a clinician/admin. */
function assertCanAccess(session, requester) {
  const isOwner = session.userId.toString() === requester.id;
  const isPrivileged = requester.role === 'clinician' || requester.role === 'admin';
  if (!isOwner && !isPrivileged) {
    throw ApiError.forbidden('You do not have access to this session');
  }
}

async function listSessions({ userId, status, from, to, page, limit }) {
  const filter = {};
  if (userId) filter.userId = userId;
  if (status) filter.status = status;
  if (from || to) {
    filter.startedAt = {};
    if (from) filter.startedAt.$gte = new Date(from);
    if (to) filter.startedAt.$lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    Session.find(filter)
      .sort({ startedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Session.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function updateSession(sessionId, updates) {
  const session = await getSessionOr404(sessionId);
  Object.assign(session, updates);
  await session.save();
  return session;
}

async function insertMetric(sessionId, metric) {
  return SpeechMetric.create({
    sessionId,
    timestamp: metric.timestamp ? new Date(metric.timestamp) : new Date(),
    elapsedSec: metric.elapsedSec,
    articulationRateSPS: metric.articulationRateSPS,
    speechRateWPM: metric.speechRateWPM,
    pauseRatio: metric.pauseRatio,
    pauseFrequencyPerMin: metric.pauseFrequencyPerMin,
    speechToPauseRatio: metric.speechToPauseRatio,
    meanPitchHz: metric.meanPitchHz,
    pitchVariabilityHz: metric.pitchVariabilityHz,
    loudnessDb: metric.loudnessDb,
    voiceActivityPercent: metric.voiceActivityPercent,
    speechConsistency: metric.speechConsistency,
    compositeScore: metric.compositeScore,
    classification: metric.classification,
    confidence: metric.confidence,
    zRate: metric.zRate,
    zPause: metric.zPause,
    zSyll: metric.zSyll,
    compositeZ: metric.compositeZ,
    sampleSufficient: metric.sampleSufficient,
    wordsPerLast30Sec: metric.wordsPerLast30Sec,
    totalSyllablesSession: metric.totalSyllablesSession,
    totalWordsSession: metric.totalWordsSession,
    rateTrend: metric.rateTrend,
    timeInAbnormalStateSec: metric.timeInAbnormalStateSec,
    recoveryTimeSec: metric.recoveryTimeSec,
    loudnessVariabilityDb: metric.loudnessVariabilityDb,
    meanPitchTrendHz: metric.meanPitchTrendHz,
  });
}

async function insertFeedbackEvent(sessionId, event) {
  return FeedbackEvent.create({
    sessionId,
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
    reason: event.reason,
    pattern: event.pattern,
  });
}

async function listMetrics(sessionId, { from, to, page, limit }) {
  const filter = { sessionId };
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = new Date(from);
    if (to) filter.timestamp.$lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    SpeechMetric.find(filter)
      .sort({ timestamp: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    SpeechMetric.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function listEvents(sessionId) {
  return FeedbackEvent.find({ sessionId }).sort({ timestamp: 1 });
}

/** Aggregates SpeechMetric + FeedbackEvent into the Session.summary snapshot. */
async function computeAndPersistSummary(sessionId) {
  const session = await getSessionOr404(sessionId);

  const [agg] = await SpeechMetric.aggregate([
    { $match: { sessionId: session._id } },
    {
      $group: {
        _id: null,
        avgArticulationRateSPS: { $avg: '$articulationRateSPS' },
        avgSpeechRateWPM: { $avg: '$speechRateWPM' },
        avgPauseRatio: { $avg: '$pauseRatio' },
        total: { $sum: 1 },
        normalCount: {
          $sum: { $cond: [{ $eq: ['$classification', CLASSIFICATION.NORMAL] }, 1, 0] },
        },
      },
    },
  ]);

  const [tachylaliaEvents, bradylaliaEvents] = await Promise.all([
    FeedbackEvent.countDocuments({ sessionId, reason: CLASSIFICATION.TACHYLALIA }),
    FeedbackEvent.countDocuments({ sessionId, reason: CLASSIFICATION.BRADYLALIA }),
  ]);

  const endedAt = session.endedAt || new Date();
  session.summary = {
    durationSec: Math.max(0, Math.round((endedAt - session.startedAt) / 1000)),
    avgArticulationRateSPS: agg?.avgArticulationRateSPS ?? null,
    avgSpeechRateWPM: agg?.avgSpeechRateWPM ?? null,
    avgPauseRatio: agg?.avgPauseRatio ?? null,
    tachylaliaEvents,
    bradylaliaEvents,
    normalRatio: agg?.total ? agg.normalCount / agg.total : null,
  };

  await session.save();
  return session;
}

async function endSession(sessionId, status = SESSION_STATUS.COMPLETED) {
  const session = await getSessionOr404(sessionId);
  session.status = status;
  session.endedAt = new Date();
  await session.save();
  const updated = await computeAndPersistSummary(sessionId);

  if (status === SESSION_STATUS.COMPLETED) {
    // Best-effort: a failure here must never block the session-ending
    // response, so it's logged rather than propagated (same policy as
    // insertMetric/insertFeedbackEvent above).
    generateAnalysisAndNotify(session).catch((err) => {
      logger.error('Post-session analysis/notification failed', { sessionId, error: err.message });
    });
  }

  return updated;
}

async function generateAnalysisAndNotify(session) {
  const analysisResult = await analysisResultService.generateFinalResult(session._id);
  await notificationService.notify({
    userId: session.userId,
    type: NOTIFICATION_TYPE.SESSION_COMPLETED,
    title: 'Session complete',
    message: `Your session has been analyzed — overall result: ${analysisResult.overallClassification}.`,
    relatedSessionId: session._id,
  });

  // Auto-generates the downloadable PDF report for this session (patient is
  // its own "author" here) — fires its own report_ready notification. Kept
  // last and still covered by endSession's outer catch: a PDF failure must
  // never mask the analysis result / session_completed notification above.
  await reportService.generatePdfForSession(session._id, { id: session.userId.toString() });
}

module.exports = {
  reapOrphanedActiveSessions,
  createSession,
  getSessionOr404,
  assertCanAccess,
  listSessions,
  updateSession,
  insertMetric,
  insertFeedbackEvent,
  listMetrics,
  listEvents,
  computeAndPersistSummary,
  endSession,
};
