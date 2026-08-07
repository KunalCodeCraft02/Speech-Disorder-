const tokenService = require('../services/tokenService');
const logger = require('../config/logger');
const env = require('../config/env');

/**
 * Socket.IO namespace middleware (`namespace.use(...)`) — verifies the JWT
 * access token supplied in the handshake and attaches `socket.user`.
 * Sockets never carry an Authorization header, so the token travels in the
 * handshake's `auth` payload: `io(url, { auth: { token } })`.
 */
function socketAuth(socket, next) {
  // Local-dev convenience -- see middleware/auth.js's authenticate() for
  // the matching REST-side bypass and why it's keyed off DEV_USER_ID.
  if (env.disableAuth) {
    socket.user = { id: env.devUserId, role: 'patient', email: 'dev@local' };
    return next();
  }

  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (!token) {
    return next(new Error('AUTH_REQUIRED'));
  }

  try {
    const payload = tokenService.verifyAccessToken(token);
    socket.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    logger.warn('Socket auth failed', { error: err.message });
    next(new Error('AUTH_INVALID'));
  }
}

module.exports = socketAuth;
