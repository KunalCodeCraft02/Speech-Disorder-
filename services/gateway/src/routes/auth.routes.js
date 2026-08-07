const express = require('express');
const authController = require('../controllers/auth.controller');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const authValidation = require('../validation/auth.validation');

const router = express.Router();

router.post('/register', authLimiter, validate(authValidation.register), authController.register);
router.post('/login', authLimiter, validate(authValidation.login), authController.login);
router.post('/refresh', authLimiter, validate(authValidation.refresh), authController.refresh);
router.post('/logout', authenticate, validate(authValidation.logout), authController.logout);

module.exports = router;
