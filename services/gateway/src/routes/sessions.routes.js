const express = require('express');
const sessionsController = require('../controllers/sessions.controller');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const sessionsValidation = require('../validation/sessions.validation');

const router = express.Router();

router.use(authenticate);

router.post('/', validate(sessionsValidation.createSession), sessionsController.createSession);
router.get('/', validate(sessionsValidation.listSessions, 'query'), sessionsController.listSessions);

router.get('/:id', validate(sessionsValidation.sessionIdParam, 'params'), sessionsController.getSession);
router.patch(
  '/:id',
  validate(sessionsValidation.sessionIdParam, 'params'),
  validate(sessionsValidation.updateSession),
  sessionsController.updateSession
);

router.get(
  '/:id/metrics',
  validate(sessionsValidation.sessionIdParam, 'params'),
  validate(sessionsValidation.metricsQuery, 'query'),
  sessionsController.getMetrics
);
router.get('/:id/events', validate(sessionsValidation.sessionIdParam, 'params'), sessionsController.getEvents);

module.exports = router;
