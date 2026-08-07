const express = require('express');
const usersController = require('../controllers/users.controller');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const usersValidation = require('../validation/users.validation');

const router = express.Router();

router.use(authenticate);

router.get('/me', usersController.getMe);
router.patch('/me', validate(usersValidation.updateMe), usersController.updateMe);

router.get('/:id/calibration', validate(usersValidation.userIdParam, 'params'), usersController.getCalibration);
router.put(
  '/:id/calibration',
  validate(usersValidation.userIdParam, 'params'),
  validate(usersValidation.updateCalibration),
  usersController.putCalibration
);
router.post(
  '/:id/calibration/record',
  validate(usersValidation.userIdParam, 'params'),
  validate(usersValidation.recordCalibration),
  usersController.recordCalibration
);

module.exports = router;
