const express = require('express');
const notificationsController = require('../controllers/notifications.controller');
const validate = require('../middleware/validate');
const { authenticate, authorize } = require('../middleware/auth');
const notificationsValidation = require('../validation/notifications.validation');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  validate(notificationsValidation.listNotifications, 'query'),
  notificationsController.listMyNotifications
);
router.post(
  '/',
  authorize(ROLES.CLINICIAN, ROLES.ADMIN),
  validate(notificationsValidation.createNotification),
  notificationsController.createNotification
);
router.post('/read-all', notificationsController.markAllRead);

router.patch(
  '/:id/read',
  validate(notificationsValidation.notificationIdParam, 'params'),
  notificationsController.markRead
);
router.delete(
  '/:id',
  validate(notificationsValidation.notificationIdParam, 'params'),
  notificationsController.deleteNotification
);

module.exports = router;
