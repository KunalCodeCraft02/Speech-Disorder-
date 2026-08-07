const ApiError = require('../utils/ApiError');
const tokenService = require('../services/tokenService');
const env = require('../config/env');

const authenticate = (req, res, next) => {
  // Local-dev convenience: DISABLE_AUTH=true skips token verification
  // entirely and treats every request as the same fixed patient (DEV_USER_ID)
  // -- no login, no auto-login call, nothing to expire or mismatch between
  // devices. Never enabled outside local/demo environments.
  if (env.disableAuth) {
    req.user = { id: env.devUserId, role: 'patient', email: 'dev@local' };
    return next();
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header'));
  }

  try {
    const payload = tokenService.verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    next(ApiError.unauthorized('Invalid or expired access token'));
  }
};

/** @param {...string} roles */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (roles.length && !roles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  next();
};

module.exports = { authenticate, authorize };
