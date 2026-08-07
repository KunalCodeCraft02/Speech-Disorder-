const Joi = require('joi');
const sessionManager = require('../../services/sessionManager');
const userService = require('../../services/userService');
const logger = require('../../config/logger');
const { SOCKET_EVENTS, SESSION_STATUS, DISORDER_MODE, sessionRoom } = require('../../utils/constants');

const sessionStartSchema = Joi.object({
  deviceId: Joi.string().hex().length(24).optional(),
  // Set once per session from the phone's landing page (Part D) -- scopes
  // the classifier to a single disorder direction for the session's whole
  // lifetime. Defaults to tachylalia if omitted so older clients keep working.
  disorderMode: Joi.string().valid(...Object.values(DISORDER_MODE)).default(DISORDER_MODE.TACHYLALIA),
  // Permits the population-default baseline fallback when the patient has
  // no calibration profile yet (Part A.1). Must never be set for a real
  // patient session -- the phone client only sets this in its demo/test path.
  demoMode: Joi.boolean().default(false),
});

async function loadCalibration(userId) {
  try {
    const profile = await userService.getCalibration(userId);
    return {
      baselineArticulationRate: profile.baselineArticulationRate,
      baselineArticulationRateStd: profile.baselineArticulationRateStd,
      baselinePauseRatio: profile.baselinePauseRatio,
      baselinePauseRatioStd: profile.baselinePauseRatioStd,
      baselineSyllableDurationSec: profile.baselineSyllableDurationSec,
      baselineSyllableDurationStd: profile.baselineSyllableDurationStd,
      baselineIpuLengthSec: profile.baselineIpuLengthSec,
      baselineIpuLengthStd: profile.baselineIpuLengthStd,
    };
  } catch (err) {
    // No calibration yet -- FastAPI will report "uncalibrated" unless the
    // session was opened with demoMode, per Part A.1.
    return null;
  }
}

function registerSessionHandlers(socket) {
  socket.on(SOCKET_EVENTS.SESSION_START, async (payload, ack) => {
    const { error, value } = sessionStartSchema.validate(payload || {});
    if (error) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'BAD_REQUEST', message: error.message });
      return;
    }

    if (socket.data.sessionId) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, {
        code: 'SESSION_ALREADY_ACTIVE',
        message: 'This connection already has an active session. Stop it before starting another.',
      });
      return;
    }

    try {
      const calibration = await loadCalibration(socket.user.id);
      const session = await sessionManager.startSession({
        userId: socket.user.id,
        deviceSocketId: socket.id,
        deviceId: value.deviceId,
        calibration,
        disorderMode: value.disorderMode,
        demoMode: value.demoMode,
      });

      const sessionId = session._id.toString();
      socket.data.sessionId = sessionId;
      socket.join(sessionRoom(sessionId));

      const ackPayload = {
        sessionId,
        startedAt: session.startedAt,
        disorderMode: session.disorderMode,
        demoMode: session.demoMode,
        calibrated: Boolean(calibration),
      };
      socket.emit(SOCKET_EVENTS.SESSION_ACK, ackPayload);
      if (typeof ack === 'function') ack(ackPayload);

      logger.info('Session started', {
        sessionId,
        userId: socket.user.id,
        socketId: socket.id,
        disorderMode: value.disorderMode,
        demoMode: value.demoMode,
        calibrated: Boolean(calibration),
      });
    } catch (err) {
      logger.error('Failed to start session', { error: err.message, userId: socket.user.id });
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'INTERNAL', message: 'Failed to start session' });
    }
  });

  socket.on(SOCKET_EVENTS.SESSION_STOP, async (payload, ack) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'NO_ACTIVE_SESSION', message: 'No active session on this connection' });
      return;
    }

    try {
      const session = await sessionManager.endSession(sessionId, SESSION_STATUS.COMPLETED);
      socket.leave(sessionRoom(sessionId));
      socket.data.sessionId = null;

      const ackPayload = { sessionId, summary: session?.summary };
      if (typeof ack === 'function') ack(ackPayload);

      logger.info('Session stopped', { sessionId, userId: socket.user.id });
    } catch (err) {
      logger.error('Failed to stop session', { error: err.message, sessionId });
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'INTERNAL', message: 'Failed to stop session' });
    }
  });

  socket.on('disconnect', async () => {
    if (socket.data.sessionId) {
      await sessionManager.abortByDeviceSocket(socket.id);
    }
  });
}

module.exports = registerSessionHandlers;
