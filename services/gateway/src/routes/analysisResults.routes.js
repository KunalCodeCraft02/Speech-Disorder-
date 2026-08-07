const express = require('express');
const analysisResultsController = require('../controllers/analysisResults.controller');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const analysisResultsValidation = require('../validation/analysisResults.validation');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  validate(analysisResultsValidation.listAnalysisResults, 'query'),
  analysisResultsController.listAnalysisResults
);
router.post(
  '/',
  authorize(ROLES.CLINICIAN, ROLES.ADMIN),
  validate(analysisResultsValidation.createAnalysisResult),
  analysisResultsController.createAnalysisResult
);

router.get(
  '/:id',
  validate(analysisResultsValidation.analysisResultIdParam, 'params'),
  analysisResultsController.getAnalysisResult
);
router.delete(
  '/:id',
  authorize(ROLES.CLINICIAN, ROLES.ADMIN),
  validate(analysisResultsValidation.analysisResultIdParam, 'params'),
  analysisResultsController.deleteAnalysisResult
);

module.exports = router;
