const { FakeDspSessionConnection } = require('./fakeDspClient');

jest.mock('../../src/services/dspClient', () => ({
  DspSessionConnection: require('./fakeDspClient').FakeDspSessionConnection,
}));

const Session = require('../../src/models/Session');
const { createUserWithToken } = require('../helpers/factories');
const { SOCKET_NAMESPACES, SOCKET_EVENTS } = require('../../src/utils/constants');
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

describe('/device namespace auth', () => {
  test('rejects a connection with no token', async () => {
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, null);
    await expect(waitForEvent(socket, 'connect')).rejects.toThrow();
    socket.close();
  });

  test('accepts a connection with a valid token', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');
    expect(socket.connected).toBe(true);
    socket.close();
  });
});

describe('session:start', () => {
  test('creates an active Session and acks with sessionId + startedAt', async () => {
    const { user, accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');

    const ack = await emitAck(socket, SOCKET_EVENTS.SESSION_START, {});
    expect(ack.sessionId).toBeDefined();
    expect(ack.startedAt).toBeDefined();

    const stored = await Session.findById(ack.sessionId);
    expect(stored).not.toBeNull();
    expect(stored.userId.toString()).toBe(user.id);
    expect(stored.status).toBe('active');

    socket.close();
  });

  test('rejects a second session:start on the same connection', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');
    await emitAck(socket, SOCKET_EVENTS.SESSION_START, {});

    const errorPromise = waitForEvent(socket, SOCKET_EVENTS.SESSION_ERROR);
    socket.emit(SOCKET_EVENTS.SESSION_START, {});
    const err = await errorPromise;
    expect(err.code).toBe('SESSION_ALREADY_ACTIVE');

    socket.close();
  });
});

describe('session:stop', () => {
  test('ends the active session and acks with a summary', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');
    const startAck = await emitAck(socket, SOCKET_EVENTS.SESSION_START, {});

    const stopAck = await emitAck(socket, SOCKET_EVENTS.SESSION_STOP, {});
    expect(stopAck.sessionId).toBe(startAck.sessionId);
    expect(stopAck.summary).toBeDefined();

    const stored = await Session.findById(startAck.sessionId);
    expect(stored.status).toBe('completed');

    socket.close();
  });

  test('errors with NO_ACTIVE_SESSION when nothing is running', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');

    const errorPromise = waitForEvent(socket, SOCKET_EVENTS.SESSION_ERROR);
    socket.emit(SOCKET_EVENTS.SESSION_STOP, {});
    const err = await errorPromise;
    expect(err.code).toBe('NO_ACTIVE_SESSION');

    socket.close();
  });
});

describe('audio:chunk', () => {
  test('is silently dropped when there is no active session (no crash, no error emitted)', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');

    let sawError = false;
    socket.on(SOCKET_EVENTS.SESSION_ERROR, () => {
      sawError = true;
    });

    socket.emit(SOCKET_EVENTS.AUDIO_CHUNK, Buffer.from([1, 2, 3, 4]));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(sawError).toBe(false);
    expect(socket.connected).toBe(true);
    socket.close();
  });

  test('is forwarded to the DSP connection once a session is active', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');
    await emitAck(socket, SOCKET_EVENTS.SESSION_START, {});

    socket.emit(SOCKET_EVENTS.AUDIO_CHUNK, Buffer.from([9, 9, 9, 9]));
    await new Promise((resolve) => setTimeout(resolve, 150));

    const fakeConn = FakeDspSessionConnection.latest();
    expect(fakeConn.sentAudio).toHaveLength(1);
    expect(Buffer.from(fakeConn.sentAudio[0])).toEqual(Buffer.from([9, 9, 9, 9]));

    socket.close();
  });

  test('an oversized chunk is rejected with a BAD_REQUEST error', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(socket, 'connect');
    await emitAck(socket, SOCKET_EVENTS.SESSION_START, {});

    const errorPromise = waitForEvent(socket, SOCKET_EVENTS.SESSION_ERROR);
    socket.emit(SOCKET_EVENTS.AUDIO_CHUNK, Buffer.alloc(64 * 1024 + 1));
    const err = await errorPromise;
    expect(err.code).toBe('BAD_REQUEST');

    socket.close();
  });
});
