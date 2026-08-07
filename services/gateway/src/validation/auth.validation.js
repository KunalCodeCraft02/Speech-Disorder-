const Joi = require('joi');
const { ROLES } = require('../utils/constants');

const password = Joi.string().min(8).max(128).required().messages({
  'string.min': 'Password must be at least 8 characters long',
});

const register = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  email: Joi.string().trim().lowercase().email().required(),
  password,
  role: Joi.string().valid(ROLES.PATIENT, ROLES.CLINICIAN).default(ROLES.PATIENT),
});

const login = Joi.object({
  email: Joi.string().trim().lowercase().email().required(),
  password: Joi.string().required(),
});

const refresh = Joi.object({
  refreshToken: Joi.string().required(),
});

const logout = Joi.object({
  refreshToken: Joi.string().required(),
});

module.exports = { register, login, refresh, logout };
