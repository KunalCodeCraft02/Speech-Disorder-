const WebSocket = require('ws');
const { EventEmitter } = require('events');
const env = require('../config/env');
const logger = require('../config/logger');

/**
 * Wire contract with the FastAPI DSP service (services/dsp-service, §08 of the
 * architecture spec):
 *
 *   Node -> FastAPI   text frame  { type: 'init', sessionId, calibration, disorderMode, demoMode }   (sent once, on open)
 *   Node -> FastAPI   binary frame  raw PCM16 mono 16kHz audio window
 *   FastAPI -> Node   text frame  { type: 'metrics', ts, elapsedSec, articulationRateSPS,
 *                                   speechRateWPM, pauseRatio, pauseFrequencyPerMin,
 *                                   speechToPauseRatio, meanPitchHz, pitchVariabilityHz,
 *                                   loudnessDb, voiceActivityPercent, speechConsistency,
 *                                   compositeScore, classification, confidence,
 *                                   triggerFeedback, feedbackReason }
 *   FastAPI -> Node   text frame  { type: 'summary', ...finalStats }
 *   FastAPI -> Node   text frame  { type: 'error', message }
 *
 * One DspSessionConnection wraps exactly one live session's socket to one
 * FastAPI worker. The DSP service is stateless across sessions, so any
 * worker behind the LB can serve any session — this class does not care
 * which physical worker it lands on.
 */
class DspSessionConnection extends EventEmitter {
  constructor(sessionId, { calibration, disorderMode, demoMode } = {}) {
    super();
    this.sessionId = sessionId;
    this.calibration = calibration || null;
    this.disorderMode = disorderMode || 'tachylalia';
    this.demoMode = Boolean(demoMode);
    this.ws = null;
    this.reconnectAttempts = 0;
    this.closedByClient = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${env.dsp.wsUrl.replace(/\/$/, '')}/ws/analyze/${this.sessionId}`;
      const headers = env.dsp.serviceToken ? { Authorization: `Bearer ${env.dsp.serviceToken}` } : {};

      const ws = new WebSocket(url, { headers, handshakeTimeout: env.dsp.connectTimeoutMs });
      this.ws = ws;

      const onOpen = () => {
        this.reconnectAttempts = 0;
        ws.send(
          JSON.stringify({
            type: 'init',
            sessionId: this.sessionId,
            calibration: this.calibration,
            disorderMode: this.disorderMode,
            demoMode: this.demoMode,
          })
        );
        this.emit('open');
        resolve();
      };

      const onMessage = (data, isBinary) => {
        if (isBinary) return; // FastAPI never sends binary back to us
        this._handleMessage(data);
      };

      const onError = (err) => {
        logger.warn('DSP connection error', { sessionId: this.sessionId, error: err.message });
        // Deliberately not 'error' — EventEmitter throws synchronously (and
        // crashes the process) when an 'error' event has no listener. This
        // connection's failures must never be able to take down the gateway.
        this.emit('connectionError', err);
      };

      const onClose = (code, reason) => {
        this.emit('close', { code, reason: reason?.toString() });
        if (this.closedByClient) return;
        this._attemptReconnect();
      };

      ws.once('open', onOpen);
      ws.on('message', onMessage);
      ws.on('error', onError);
      ws.once('close', onClose);

      ws.once('error', (err) => {
        if (ws.readyState !== WebSocket.OPEN) reject(err);
      });
    });
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      logger.warn('Received malformed DSP frame', { sessionId: this.sessionId });
      return;
    }

    switch (msg.type) {
      case 'metrics':
        this.emit('metrics', msg);
        break;
      case 'summary':
        this.emit('summary', msg);
        break;
      case 'error':
        this.emit('dspError', msg);
        break;
      default:
        logger.warn('Unknown DSP frame type', { sessionId: this.sessionId, type: msg.type });
    }
  }

  _attemptReconnect() {
    if (this.reconnectAttempts >= env.dsp.maxReconnectAttempts) {
      logger.error('DSP reconnect attempts exhausted', { sessionId: this.sessionId });
      this.emit('fatal', new Error('Unable to reconnect to DSP service'));
      return;
    }

    const delay = env.dsp.reconnectBaseDelayMs * 2 ** this.reconnectAttempts;
    this.reconnectAttempts += 1;

    setTimeout(() => {
      if (this.closedByClient) return;
      logger.info('Reconnecting to DSP service', { sessionId: this.sessionId, attempt: this.reconnectAttempts });
      this.connect().catch(() => {
        /* onClose handler will schedule the next attempt */
      });
    }, delay);
  }

  sendAudio(buffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Dropped audio frame — DSP socket not open', { sessionId: this.sessionId });
      return false;
    }
    this.ws.send(buffer, { binary: true });
    return true;
  }

  requestSummary() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'end' }));
    }
  }

  close() {
    this.closedByClient = true;
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'session ended');
      }
    }
  }
}

module.exports = { DspSessionConnection };
