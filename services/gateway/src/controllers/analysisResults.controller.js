const asyncHandler = require('../utils/asyncHandler');
const analysisResultService = require('../services/analysisResultService');
const { ROLES } = require('../utils/constants');

const listAnalysisResults = asyncHandler(async (req, res) => {
  const query = { ...req.query };

  // Patients may only ever list their own analysis results.
  if (req.user.role === ROLES.PATIENT) {
    query.userId = req.user.id;
  }

  const result = await analysisResultService.listResults(query);
  res.status(200).json({ success: true, data: result });
});

const getAnalysisResult = asyncHandler(async (req, res) => {
  const result = await analysisResultService.getByIdOr404(req.params.id);
  analysisResultService.assertCanAccess(result, req.user);
  res.status(200).json({ success: true, data: result });
});

const createAnalysisResult = asyncHandler(async (req, res) => {
  const { sessionId, ...data } = req.body;
  const result = await analysisResultService.createManual(sessionId, data, req.user);
  res.status(201).json({ success: true, data: result });
});

const deleteAnalysisResult = asyncHandler(async (req, res) => {
  const result = await analysisResultService.getByIdOr404(req.params.id);
  analysisResultService.assertCanAccess(result, req.user);
  await analysisResultService.deleteResult(req.params.id);
  res.status(204).send();
});

module.exports = { listAnalysisResults, getAnalysisResult, createAnalysisResult, deleteAnalysisResult };
