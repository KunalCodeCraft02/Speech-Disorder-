const { EventEmitter } = require('events');
const { DspSessionConnection } = require('./dspClient');
const sessionService = require('./sessionService');
const logger = require('../config/logger');
const { CLASSIFICATION, DISORDER_MODE, VIBRATION_PATTERNS, SESSION_STATUS } = require('../utils/constants');

/**
 * Owns every *live* session's in-memory state: which phone socket is
 * streaming, which dashboard sockets are watching, and the DSP connection
 * doing the analysis. This is the orchestration layer between the socket
 * transport and persistence — it never touches `io` directly. Socket
 * handlers subscribe to the events this class emits and are responsible for
 * the actual `emit()` calls; that keeps this class transport-agnostic and
 * unit-testable without a running Socket.IO server.
 *
 * Emitted events:
 *   'started'  { sessionId, userId, startedAt }
 *   'metrics'  { sessionId, frame }
 *   'feedback' { sessionId, reason, pattern }
 *   'ended'    { sessionId, summary }
 *   'fatal'    { sessionId, error }
 */
class SessionManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} sessionId -> context */
    this.sessions = new Map();
    /** @type {Map<string, string>} deviceSocketId -> sessionId */
    this.socketToSession = new Map();
  }

  async startSession({ userId, deviceSocketId, deviceId, calibration, disorderMode, demoMode }) {
    const resolvedMode = Object.values(DISORDER_MODE).includes(disorderMode) ? disorderMode : DISORDER_MODE.TACHYLALIA;
    const session = await sessionService.createSession(userId, deviceId, { disorderMode: resolvedMode, demoMode });
    const sessionId = session._id.toString();

    const dsp = new DspSessionConnection(sessionId, { calibration, disorderMode: resolvedMode, demoMode });
    const context = {
      sessionId,
      userId: userId.toString(),
      deviceSocketId,
      disorderMode: resolvedMode,
      demoMode: Boolean(demoMode),
      dashboardSocketIds: new Set(),
      dsp,
      status: SESSION_STATUS.ACTIVE,
      startedAt: session.startedAt,
      lastHeartbeat: null,
    };

    this._wireDsp(context);

    this.sessions.set(sessionId, context);
    this.socketToSession.set(deviceSocketId, sessionId);

    this.emit('started', {
      sessionId,
      userId: context.userId,
      startedAt: session.startedAt,
      disorderMode: resolvedMode,
      demoMode: context.demoMode,
    });

    try {
      await dsp.connect();
    } catch (err) {
      logger.error('Failed to establish DSP connection for session', { sessionId, error: err.message });
      // The session still exists — dsp will keep retrying via its own
      // reconnect loop, and audio frames are simply dropped until it's back.
    }

    return session;
  }

  _wireDsp(context) {
    const { sessionId, dsp } = context;

    dsp.on('metrics', (frame) => {
      sessionService.insertMetric(sessionId, frame).catch((err) => {
        logger.error('Failed to persist SpeechMetric', { sessionId, error: err.message });
      });

      this.emit('metrics', { sessionId, frame });

      // The vibration pattern is keyed by the session's disorderMode, not
      // by the per-frame classification -- a session can only ever confirm
      // its own mode's disorder (Part B.8), so this is always the one
      // pattern that mode's session would ever ask the phone to play.
      if (frame.triggerFeedback && VIBRATION_PATTERNS[context.disorderMode]) {
        const pattern = VIBRATION_PATTERNS[context.disorderMode];
        const reason = frame.classification;

        sessionService.insertFeedbackEvent(sessionId, { reason, pattern }).catch((err) => {
          logger.error('Failed to persist FeedbackEvent', { sessionId, error: err.message });
        });

        this.emit('feedback', { sessionId, reason, pattern });
      }
    });

    dsp.on('dspError', (msg) => {
      logger.warn('DSP reported an analysis error', { sessionId, message: msg.message });
    });

    dsp.on('connectionError', (err) => {
      logger.debug('DSP connection-level error', { sessionId, error: err.message });
    });

    dsp.on('fatal', (error) => {
      logger.error('DSP connection unrecoverable — ending session', { sessionId, error: error.message });
      this.emit('fatal', { sessionId, error });
      this.endSession(sessionId, SESSION_STATUS.ABORTED).catch(() => {});
    });
  }

  attachDashboard(sessionId, socketId) {
    const context = this.sessions.get(sessionId);
    if (!context) return false;
    context.dashboardSocketIds.add(socketId);
    return true;
  }

  detachDashboard(sessionId, socketId) {
    const context = this.sessions.get(sessionId);
    if (!context) return;
    context.dashboardSocketIds.delete(socketId);
  }

  recordAudioChunk(sessionId, buffer) {
    const context = this.sessions.get(sessionId);
    if (!context) return false;
    return context.dsp.sendAudio(buffer);
  }

  recordHeartbeat(sessionId, heartbeat) {
    const context = this.sessions.get(sessionId);
    if (!context) return;
    context.lastHeartbeat = { ...heartbeat, at: new Date() };
  }

  getContext(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  getSessionIdForSocket(deviceSocketId) {
    return this.socketToSession.get(deviceSocketId) || null;
  }

  isValidClassification(classification) {
    return Object.values(CLASSIFICATION).includes(classification);
  }

  async endSession(sessionId, status = SESSION_STATUS.COMPLETED) {
    const context = this.sessions.get(sessionId);
    if (!context) return null;

    context.dsp.requestSummary();
    context.dsp.close();

    const session = await sessionService.endSession(sessionId, status);

    this.sessions.delete(sessionId);
    this.socketToSession.delete(context.deviceSocketId);

    this.emit('ended', { sessionId, summary: session.summary });
    return session;
  }

  /** Called when a phone's socket disconnects mid-session. */
  async abortByDeviceSocket(deviceSocketId) {
    const sessionId = this.socketToSession.get(deviceSocketId);
    if (!sessionId) return;
    logger.info('Device disconnected mid-session — aborting', { sessionId });
    await this.endSession(sessionId, SESSION_STATUS.ABORTED).catch((err) => {
      logger.error('Failed to abort session on disconnect', { sessionId, error: err.message });
    });
  }
}

module.exports = new SessionManager();
