const Joi = require('joi');
const sessionManager = require('../../services/sessionManager');
const sessionService = require('../../services/sessionService');
const logger = require('../../config/logger');
const { SOCKET_EVENTS, ROLES, sessionRoom, userRoom } = require('../../utils/constants');

const objectId = Joi.string().hex().length(24).required();
const userScopeSchema = Joi.object({ userId: objectId });
const sessionScopeSchema = Joi.object({ sessionId: objectId });

function canViewUser(requester, targetUserId) {
  return requester.id === targetUserId || requester.role === ROLES.CLINICIAN || requester.role === ROLES.ADMIN;
}

function registerDashboardHandlers(socket) {
  socket.data.subscribedSessions = new Set();

  socket.on(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_USER, (payload, ack) => {
    const { error, value } = userScopeSchema.validate(payload || {});
    if (error) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'BAD_REQUEST', message: error.message });
      return;
    }

    if (!canViewUser(socket.user, value.userId)) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'FORBIDDEN', message: 'Not authorized for this user' });
      return;
    }

    socket.join(userRoom(value.userId));
    if (typeof ack === 'function') ack({ userId: value.userId });
  });

  socket.on(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, async (payload, ack) => {
    const { error, value } = sessionScopeSchema.validate(payload || {});
    if (error) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'BAD_REQUEST', message: error.message });
      return;
    }

    try {
      const session = await sessionService.getSessionOr404(value.sessionId);
      sessionService.assertCanAccess(session, socket.user);

      socket.join(sessionRoom(value.sessionId));
      socket.data.subscribedSessions.add(value.sessionId);
      sessionManager.attachDashboard(value.sessionId, socket.id);

      if (typeof ack === 'function') ack({ sessionId: value.sessionId, status: session.status });
    } catch (err) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, {
        code: err.code || 'INTERNAL',
        message: err.message || 'Failed to subscribe to session',
      });
    }
  });

  socket.on(SOCKET_EVENTS.DASHBOARD_UNSUBSCRIBE_SESSION, (payload) => {
    const { error, value } = sessionScopeSchema.validate(payload || {});
    if (error) return;

    socket.leave(sessionRoom(value.sessionId));
    socket.data.subscribedSessions.delete(value.sessionId);
    sessionManager.detachDashboard(value.sessionId, socket.id);
  });

  socket.on('disconnect', () => {
    for (const sessionId of socket.data.subscribedSessions) {
      sessionManager.detachDashboard(sessionId, socket.id);
    }
    logger.debug('Dashboard socket disconnected', { socketId: socket.id, userId: socket.user?.id });
  });
}

module.exports = registerDashboardHandlers;
