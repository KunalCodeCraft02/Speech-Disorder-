const { FakeDspSessionConnection } = require('./fakeDspClient');

jest.mock('../../src/services/dspClient', () => ({
  DspSessionConnection: require('./fakeDspClient').FakeDspSessionConnection,
}));

const Session = require('../../src/models/Session');
const { createUserWithToken } = require('../helpers/factories');
const { SOCKET_NAMESPACES, SOCKET_EVENTS } = require('../../src/utils/constants');
const { waitFor } = require('../helpers/waitFor');
const { startTestServer, connectClient, waitForEvent, emitAck } = require('./testServer');

let server;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  FakeDspSessionConnection.reset();
});

describe('an unrecoverable DSP link failure', () => {
  test('aborts the session and notifies the phone with SESSION_ERROR DSP_UNAVAILABLE', async () => {
    const { accessToken } = await createUserWithToken();
    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, {});

    const errorPromise = waitForEvent(deviceSocket, SOCKET_EVENTS.SESSION_ERROR);
    const fakeConn = FakeDspSessionConnection.latest();
    fakeConn.emit('fatal', new Error('unable to reconnect'));

    const err = await errorPromise;
    expect(err.code).toBe('DSP_UNAVAILABLE');

    const stored = await waitFor(async () => {
      const s = await Session.findById(startAck.sessionId);
      if (s.status === 'active') throw new Error('not aborted yet');
      return s;
    });
    expect(stored.status).toBe('aborted');

    deviceSocket.close();
  });
});

describe('the phone disconnecting mid-session', () => {
  test('aborts the session server-side', async () => {
    const { accessToken } = await createUserWithToken();
    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, {});

    deviceSocket.close();

    const stored = await waitFor(async () => {
      const s = await Session.findById(startAck.sessionId);
      if (s.status === 'active') throw new Error('not aborted yet');
      return s;
    });
    expect(stored.status).toBe('aborted');
  });
});
