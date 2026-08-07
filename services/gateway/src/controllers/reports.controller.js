const asyncHandler = require('../utils/asyncHandler');
const reportService = require('../services/reportService');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');

const createReport = asyncHandler(async (req, res) => {
  const report = await reportService.createReport(req.user.id, req.body);
  res.status(201).json({ success: true, data: report });
});

const listReports = asyncHandler(async (req, res) => {
  const query = { ...req.query };

  // Patients may only ever list reports about themselves.
  if (req.user.role === ROLES.PATIENT) {
    query.userId = req.user.id;
  }

  const result = await reportService.listReports(query);
  res.status(200).json({ success: true, data: result });
});

const getReport = asyncHandler(async (req, res) => {
  const report = await reportService.getByIdOr404(req.params.id);
  reportService.assertCanAccess(report, req.user);
  res.status(200).json({ success: true, data: report });
});

const updateReport = asyncHandler(async (req, res) => {
  const report = await reportService.getByIdOr404(req.params.id);
  const isAuthor = report.authorId.toString() === req.user.id;
  const isPrivileged = req.user.role === ROLES.CLINICIAN || req.user.role === ROLES.ADMIN;
  if (!isAuthor && !isPrivileged) {
    throw ApiError.forbidden('Only the report author or a clinician/admin may update this report');
  }

  const updated = await reportService.updateReport(req.params.id, req.body);
  res.status(200).json({ success: true, data: updated });
});

const shareReport = asyncHandler(async (req, res) => {
  const report = await reportService.getByIdOr404(req.params.id);
  reportService.assertCanAccess(report, req.user);
  const updated = await reportService.shareReport(req.params.id, req.body.userId);
  res.status(200).json({ success: true, data: updated });
});

const deleteReport = asyncHandler(async (req, res) => {
  const report = await reportService.getByIdOr404(req.params.id);
  const isAuthor = report.authorId.toString() === req.user.id;
  const isPrivileged = req.user.role === ROLES.CLINICIAN || req.user.role === ROLES.ADMIN;
  if (!isAuthor && !isPrivileged) {
    throw ApiError.forbidden('Only the report author or a clinician/admin may delete this report');
  }

  await reportService.deleteReport(req.params.id);
  res.status(204).send();
});

// Builds (or rebuilds) the PDF for a single session in one call — the
// "Generate report" action the dashboard's session history offers.
const generateForSession = asyncHandler(async (req, res) => {
  const report = await reportService.generatePdfForSession(req.params.sessionId, req.user, req.body);
  res.status(201).json({ success: true, data: report });
});

const downloadReport = asyncHandler(async (req, res) => {
  const report = await reportService.getPdfBuffer(req.params.id);
  reportService.assertCanAccess(report, req.user);

  const filename = `${report.title.replace(/[^\w.-]+/g, '_')}.pdf`;
  res.status(200);
  res.set({
    'Content-Type': report.pdf.contentType || 'application/pdf',
    'Content-Length': report.pdf.size ?? report.pdf.data.length,
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.send(report.pdf.data);
});

module.exports = {
  createReport,
  listReports,
  getReport,
  updateReport,
  shareReport,
  deleteReport,
  generateForSession,
  downloadReport,
};
