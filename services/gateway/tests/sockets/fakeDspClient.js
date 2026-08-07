// A stand-in for services/dspClient's DspSessionConnection. Socket tests
// exercise the gateway's own session/broadcast logic, not a real DSP link —
// dsp-service has its own full test suite for that. `connect()` resolves
// immediately (no real network call, no reconnect-timer loop), and each
// instance is tracked so a test can grab the one just created by
// sessionManager.startSession and manually fire a 'metrics' event to
// simulate the DSP service, or a 'fatal' event to simulate an unrecoverable
// link failure.
const { EventEmitter } = require('events');

class FakeDspSessionConnection extends EventEmitter {
  constructor(sessionId, opts = {}) {
    super();
    this.sessionId = sessionId;
    this.calibration = opts.calibration || null;
    this.sentAudio = [];
    this.closed = false;
    FakeDspSessionConnection.instances.push(this);
  }

  connect() {
    return Promise.resolve();
  }

  sendAudio(buffer) {
    this.sentAudio.push(buffer);
    return true;
  }

  requestSummary() {
    this.emit('summary', { type: 'summary' });
  }

  close() {
    this.closed = true;
  }

  static latest() {
    return FakeDspSessionConnection.instances[FakeDspSessionConnection.instances.length - 1];
  }

  static reset() {
    FakeDspSessionConnection.instances = [];
  }
}

FakeDspSessionConnection.instances = [];

module.exports = { FakeDspSessionConnection };
