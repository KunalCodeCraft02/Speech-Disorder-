const express = require('express');
const reportsController = require('../controllers/reports.controller');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const reportsValidation = require('../validation/reports.validation');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticate);

router.post(
  '/',
  authorize(ROLES.CLINICIAN, ROLES.ADMIN),
  validate(reportsValidation.createReport),
  reportsController.createReport
);
router.get('/', validate(reportsValidation.listReports, 'query'), reportsController.listReports);

router.get('/:id', validate(reportsValidation.reportIdParam, 'params'), reportsController.getReport);
router.patch(
  '/:id',
  validate(reportsValidation.reportIdParam, 'params'),
  validate(reportsValidation.updateReport),
  reportsController.updateReport
);
router.delete('/:id', validate(reportsValidation.reportIdParam, 'params'), reportsController.deleteReport);

router.post(
  '/:id/share',
  authorize(ROLES.CLINICIAN, ROLES.ADMIN),
  validate(reportsValidation.reportIdParam, 'params'),
  validate(reportsValidation.shareReport),
  reportsController.shareReport
);

router.get('/:id/download', validate(reportsValidation.reportIdParam, 'params'), reportsController.downloadReport);

router.post(
  '/sessions/:sessionId/generate',
  authorize(ROLES.CLINICIAN, ROLES.ADMIN),
  validate(reportsValidation.sessionIdParam, 'params'),
  validate(reportsValidation.generateForSession),
  reportsController.generateForSession
);

module.exports = router;
