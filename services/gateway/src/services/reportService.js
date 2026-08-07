const Report = require('../models/Report');
const Session = require('../models/Session');
const User = require('../models/User');
const Profile = require('../models/Profile');
const SpeechMetric = require('../models/SpeechMetric');
const AnalysisResult = require('../models/AnalysisResult');
const analysisResultService = require('./analysisResultService');
const notificationService = require('./notificationService');
const { buildSessionReportPdf } = require('./pdf/reportPdfBuilder');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const {
  ROLES,
  REPORT_STATUS,
  REPORT_TYPE,
  ANALYSIS_TYPE,
  NOTIFICATION_TYPE,
  NOTIFICATION_PRIORITY,
} = require('../utils/constants');

async function getByIdOr404(id) {
  const report = await Report.findById(id);
  if (!report) throw ApiError.notFound('Report not found');
  return report;
}

/** Throws 403 unless the requester is the patient, the author, a clinician/admin, or an explicit share target. */
function assertCanAccess(report, requester) {
  const isOwner = report.userId.toString() === requester.id;
  const isAuthor = report.authorId.toString() === requester.id;
  const isPrivileged = requester.role === ROLES.CLINICIAN || requester.role === ROLES.ADMIN;
  const isSharedWith = report.sharedWith.some((s) => s.userId.toString() === requester.id);

  if (!isOwner && !isAuthor && !isPrivileged && !isSharedWith) {
    throw ApiError.forbidden('You do not have access to this report');
  }
}

async function notifyReportReady(report) {
  await notificationService
    .notify({
      userId: report.userId,
      type: NOTIFICATION_TYPE.REPORT_READY,
      priority: NOTIFICATION_PRIORITY.HIGH,
      title: 'Your report is ready',
      message: `"${report.title}" has been finalized and is ready to view.`,
      relatedReportId: report._id,
    })
    .catch((err) => logger.error('Failed to send report_ready notification', { reportId: report._id, error: err.message }));
}

async function createReport(authorId, data) {
  if (data.sessionIds?.length) {
    const count = await Session.countDocuments({ _id: { $in: data.sessionIds } });
    if (count !== data.sessionIds.length) {
      throw ApiError.badRequest('One or more sessionIds do not exist');
    }
  }

  return Report.create({ ...data, authorId });
}

async function listReports({ userId, authorId, sessionId, status, type, page, limit }) {
  const filter = {};
  if (userId) filter.userId = userId;
  if (authorId) filter.authorId = authorId;
  if (sessionId) filter.sessionIds = sessionId;
  if (status) filter.status = status;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Report.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function updateReport(id, updates) {
  const report = await getByIdOr404(id);
  const wasFinalized = report.status === REPORT_STATUS.FINALIZED;

  Object.assign(report, updates);
  if (updates.status === REPORT_STATUS.FINALIZED && !wasFinalized) {
    report.generatedAt = new Date();
  }

  await report.save();

  if (updates.status === REPORT_STATUS.FINALIZED && !wasFinalized) {
    await notifyReportReady(report);
  }

  return report;
}

async function shareReport(id, targetUserId) {
  const report = await getByIdOr404(id);
  const alreadyShared = report.sharedWith.some((s) => s.userId.toString() === targetUserId);
  if (!alreadyShared) {
    report.sharedWith.push({ userId: targetUserId });
    await report.save();
  }
  return report;
}

async function deleteReport(id) {
  const report = await getByIdOr404(id);
  await report.deleteOne();
}

/**
 * Builds (or rebuilds) the PDF for a single session's report: gathers the
 * patient, session, final AnalysisResult, calibration baseline and raw
 * SpeechMetric time-series, renders the PDF via reportPdfBuilder, and stores
 * it directly on the Report document. Creates the Report if one doesn't
 * already exist for this session; regenerates it in place otherwise, so
 * calling this again after new data always produces the current PDF under
 * the same report id. Finalizing fires a `report_ready` notification.
 */
async function generatePdfForSession(sessionId, author, { title } = {}) {
  const session = await Session.findById(sessionId);
  if (!session) throw ApiError.notFound('Session not found');

  let analysisResult = await AnalysisResult.findOne({ sessionId, type: ANALYSIS_TYPE.SESSION_FINAL });
  if (!analysisResult) {
    // Sessions that ended abnormally (or predate this feature) may not have
    // a persisted final result yet — derive one now instead of failing.
    analysisResult = await analysisResultService.generateFinalResult(sessionId);
  }

  const [user, profile, metrics] = await Promise.all([
    User.findById(session.userId),
    Profile.findOne({ userId: session.userId }),
    SpeechMetric.find({ sessionId }).sort({ timestamp: 1 }),
  ]);
  if (!user) throw ApiError.notFound('Patient not found');

  let report = await Report.findOne({ sessionIds: session._id, type: REPORT_TYPE.SESSION });
  if (!report) {
    report = new Report({
      userId: session.userId,
      authorId: author.id,
      title: title || `Speech Session Report — ${session.startedAt.toISOString().slice(0, 10)}`,
      type: REPORT_TYPE.SESSION,
      sessionIds: [session._id],
    });
  } else if (title) {
    report.title = title;
  }
  report.analysisResultIds = [analysisResult._id];

  const pdfBuffer = await buildSessionReportPdf({
    report,
    user: user.toSafeJSON(),
    session,
    analysisResult,
    profile,
    metrics,
  });

  report.pdf = { data: pdfBuffer, contentType: 'application/pdf', size: pdfBuffer.length };
  report.status = REPORT_STATUS.FINALIZED;
  report.generatedAt = new Date();
  await report.save();

  await notifyReportReady(report);

  const plain = report.toObject();
  delete plain.pdf.data; // metadata only — callers fetch the binary via getPdfBuffer/download
  return plain;
}

/** Loads a report's stored PDF binary. Throws 400 if it hasn't been generated yet. */
async function getPdfBuffer(id) {
  const report = await Report.findById(id).select('+pdf.data');
  if (!report) throw ApiError.notFound('Report not found');
  if (!report.pdf?.data) throw ApiError.badRequest('This report has not been generated yet');
  return report;
}

module.exports = {
  getByIdOr404,
  assertCanAccess,
  createReport,
  listReports,
  updateReport,
  shareReport,
  deleteReport,
  generatePdfForSession,
  getPdfBuffer,
};
