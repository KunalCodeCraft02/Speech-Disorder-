const Joi = require('joi');
const sessionManager = require('../../services/sessionManager');
const logger = require('../../config/logger');
const { SOCKET_EVENTS } = require('../../utils/constants');

const MAX_CHUNK_BYTES = 64 * 1024; // ~2s of 16kHz mono PCM16 — generous upper bound per frame

const heartbeatSchema = Joi.object({
  batteryLevel: Joi.number().min(0).max(1),
  micLevel: Joi.number().min(0).max(1),
});

function registerAudioHandlers(socket) {
  socket.on(SOCKET_EVENTS.AUDIO_CHUNK, (chunk) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) {
      // Silently drop — a chunk arriving before session:ack is a client race,
      // not an error worth surfacing on every frame.
      return;
    }

    if (!Buffer.isBuffer(chunk) && !(chunk instanceof ArrayBuffer)) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'BAD_REQUEST', message: 'audio:chunk must be binary' });
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.length === 0 || buffer.length > MAX_CHUNK_BYTES) {
      socket.emit(SOCKET_EVENTS.SESSION_ERROR, { code: 'BAD_REQUEST', message: 'audio:chunk out of allowed size range' });
      return;
    }

    const forwarded = sessionManager.recordAudioChunk(sessionId, buffer);
    if (!forwarded) {
      logger.debug('Audio frame dropped — DSP link not ready', { sessionId });
    }
  });

  socket.on(SOCKET_EVENTS.DEVICE_HEARTBEAT, (payload) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;

    const { error, value } = heartbeatSchema.validate(payload || {});
    if (error) return;

    sessionManager.recordHeartbeat(sessionId, value);
  });
}

module.exports = registerAudioHandlers;
