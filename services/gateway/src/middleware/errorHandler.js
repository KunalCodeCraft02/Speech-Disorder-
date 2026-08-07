const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const env = require('../config/env');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;

  if (!(error instanceof ApiError)) {
    error = normalizeError(error);
  }

  const { statusCode, message, code, details, isOperational } = error;

  if (!isOperational || statusCode >= 500) {
    logger.error(message, {
      code,
      statusCode,
      path: req.originalUrl,
      method: req.method,
      userId: req.user && req.user.id,
      stack: err.stack,
    });
  } else {
    logger.warn(message, { code, statusCode, path: req.originalUrl, method: req.method });
  }

  res.status(statusCode || 500).json({
    success: false,
    error: {
      code: code || 'INTERNAL',
      message: env.isProduction && (!statusCode || statusCode >= 500) ? 'Internal server error' : message,
      ...(details ? { details } : {}),
    },
  });
}

function normalizeError(err) {
  if (err.name === 'ValidationError') {
    // Mongoose schema validation error
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest('Validation failed', details);
  }

  if (err.name === 'CastError') {
    return ApiError.badRequest(`Invalid value for field '${err.path}'`);
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return ApiError.conflict(`${field} already in use`);
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return ApiError.unauthorized('Invalid or expired token');
  }

  return ApiError.internal(err.message);
}

module.exports = errorHandler;
