const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const env = require('../config/env');
const logger = require('../config/logger');
const { createRedisClients } = require('../config/redis');
const sessionManager = require('../services/sessionManager');
const mountDeviceNamespace = require('./namespaces/device.namespace');
const mountDashboardNamespace = require('./namespaces/dashboard.namespace');
const { SOCKET_NAMESPACES, SOCKET_EVENTS, sessionRoom, userRoom } = require('../utils/constants');

/**
 * Wires sessionManager's transport-agnostic events onto actual Socket.IO
 * emits. Centralized here (rather than inside the handlers that triggered
 * the underlying action) so a session ended by an explicit `session:stop`,
 * a device disconnect, or a DSP failure all broadcast identically.
 */
function wireSessionManagerBroadcasts(io) {
  const dashboardNsp = io.of(SOCKET_NAMESPACES.DASHBOARD);
  const deviceNsp = io.of(SOCKET_NAMESPACES.DEVICE);

  sessionManager.on('started', ({ sessionId, userId, startedAt, disorderMode, demoMode }) => {
    dashboardNsp.to(userRoom(userId)).emit(SOCKET_EVENTS.SESSION_STARTED, { sessionId, userId, startedAt, disorderMode, demoMode });
  });

  sessionManager.on('metrics', ({ sessionId, frame }) => {
    dashboardNsp.to(sessionRoom(sessionId)).emit(SOCKET_EVENTS.METRICS_UPDATE, {
      sessionId,
      ts: frame.ts,
      elapsedSec: frame.elapsedSec,
      articulationRateSPS: frame.articulationRateSPS,
      speechRateWPM: frame.speechRateWPM,
      pauseRatio: frame.pauseRatio,
      pauseFrequencyPerMin: frame.pauseFrequencyPerMin,
      speechToPauseRatio: frame.speechToPauseRatio,
      averageSyllableDurationSec: frame.averageSyllableDurationSec,
      interSyllableIntervalSec: frame.interSyllableIntervalSec,
      pauseDurationSec: frame.pauseDurationSec,
      interPausalUnitLengthSec: frame.interPausalUnitLengthSec,
      meanPitchHz: frame.meanPitchHz,
      pitchVariabilityHz: frame.pitchVariabilityHz,
      loudnessDb: frame.loudnessDb,
      voiceActivityPercent: frame.voiceActivityPercent,
      speechConsistency: frame.speechConsistency,
      compositeScore: frame.compositeScore,
      classification: frame.classification,
      confidence: frame.confidence,
      triggerFeedback: frame.triggerFeedback,
      feedbackReason: frame.feedbackReason,
      // Part B.6/B.7/B.9 -- decision-audit fields, present on every frame.
      zRate: frame.zRate,
      zPause: frame.zPause,
      zSyll: frame.zSyll,
      compositeZ: frame.compositeZ,
      sampleSufficient: frame.sampleSufficient,
      // Part C.10 -- new derived parameters.
      wordsPerLast30Sec: frame.wordsPerLast30Sec,
      totalSyllablesSession: frame.totalSyllablesSession,
      totalWordsSession: frame.totalWordsSession,
      rateTrend: frame.rateTrend,
      timeInAbnormalStateSec: frame.timeInAbnormalStateSec,
      recoveryTimeSec: frame.recoveryTimeSec,
      loudnessVariabilityDb: frame.loudnessVariabilityDb,
      meanPitchTrendHz: frame.meanPitchTrendHz,
    });
  });

  sessionManager.on('feedback', ({ sessionId, reason, pattern }) => {
    dashboardNsp.to(sessionRoom(sessionId)).emit(SOCKET_EVENTS.FEEDBACK_LOGGED, {
      sessionId,
      reason,
      pattern,
      ts: new Date().toISOString(),
    });

    const context = sessionManager.getContext(sessionId);
    if (context) {
      deviceNsp.to(context.deviceSocketId).emit(SOCKET_EVENTS.VIBRATION_COMMAND, { pattern, reason });
    }
  });

  sessionManager.on('ended', ({ sessionId, summary }) => {
    dashboardNsp.to(sessionRoom(sessionId)).emit(SOCKET_EVENTS.SESSION_ENDED, { sessionId, summary });
  });

  sessionManager.on('fatal', ({ sessionId, error }) => {
    const context = sessionManager.getContext(sessionId);
    if (context) {
      deviceNsp.to(context.deviceSocketId).emit(SOCKET_EVENTS.SESSION_ERROR, {
        code: 'DSP_UNAVAILABLE',
        message: 'Lost connection to the analysis service — session ended',
      });
    }
    logger.error('Session ended due to fatal DSP error', { sessionId, error: error.message });
  });
}

async function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true },
    maxHttpBufferSize: 1e6, // 1MB — generous ceiling for a single audio frame
  });

  const redisClients = await createRedisClients();
  if (redisClients) {
    io.adapter(createAdapter(redisClients.pubClient, redisClients.subClient));
    logger.info('Socket.IO using Redis adapter');
  }

  mountDeviceNamespace(io);
  mountDashboardNamespace(io);
  wireSessionManagerBroadcasts(io);

  return io;
}

module.exports = initSocketServer;
