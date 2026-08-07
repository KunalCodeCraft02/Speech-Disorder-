const Session = require('../../src/models/Session');
const { createUserWithToken } = require('../helpers/factories');
const { ROLES, SOCKET_NAMESPACES, SOCKET_EVENTS } = require('../../src/utils/constants');
const { startTestServer, connectClient, waitForEvent, emitAck } = require('./testServer');

let server;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.stop();
});

describe('/dashboard namespace auth', () => {
  test('rejects a connection with no token', async () => {
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, null);
    await expect(waitForEvent(socket, 'connect')).rejects.toThrow();
    socket.close();
  });

  test('rejects a connection with an invalid token', async () => {
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, 'garbage-token');
    await expect(waitForEvent(socket, 'connect')).rejects.toThrow();
    socket.close();
  });

  test('accepts a connection with a valid access token', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(socket, 'connect');
    expect(socket.connected).toBe(true);
    socket.close();
  });
});

describe('dashboard:subscribeUser', () => {
  test('a user can subscribe to their own user room', async () => {
    const { user, accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(socket, 'connect');

    const ack = await emitAck(socket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_USER, { userId: user.id });
    expect(ack).toEqual({ userId: user.id });
    socket.close();
  });

  test('a patient cannot subscribe to another patient user room', async () => {
    const { user: otherPatient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(socket, 'connect');

    const errorPromise = waitForEvent(socket, SOCKET_EVENTS.SESSION_ERROR);
    socket.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_USER, { userId: otherPatient.id });
    const err = await errorPromise;
    expect(err.code).toBe('FORBIDDEN');
    socket.close();
  });

  test('a clinician can subscribe to any patient user room', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, clinicianToken);
    await waitForEvent(socket, 'connect');

    const ack = await emitAck(socket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_USER, { userId: patient.id });
    expect(ack).toEqual({ userId: patient.id });
    socket.close();
  });
});

describe('dashboard:subscribe (session)', () => {
  test('the owning patient can subscribe to their own session', async () => {
    const { user, accessToken } = await createUserWithToken();
    const session = await Session.create({ userId: user._id, status: 'active', startedAt: new Date() });

    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(socket, 'connect');

    const ack = await emitAck(socket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: session._id.toString() });
    expect(ack).toEqual({ sessionId: session._id.toString(), status: 'active' });
    socket.close();
  });

  test('a different patient is refused with a SESSION_ERROR', async () => {
    const { user: owner } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: otherToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const session = await Session.create({ userId: owner._id, status: 'active', startedAt: new Date() });

    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, otherToken);
    await waitForEvent(socket, 'connect');

    const errorPromise = waitForEvent(socket, SOCKET_EVENTS.SESSION_ERROR);
    socket.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: session._id.toString() });
    const err = await errorPromise;
    expect(err.code).toBe('FORBIDDEN');
    socket.close();
  });

  test('a nonexistent session id returns a NOT_FOUND error', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(socket, 'connect');

    const errorPromise = waitForEvent(socket, SOCKET_EVENTS.SESSION_ERROR);
    socket.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: '64a1b2c3d4e5f6a7b8c9d0e1' });
    const err = await errorPromise;
    expect(err.code).toBe('NOT_FOUND');
    socket.close();
  });

  test('a malformed sessionId is rejected as BAD_REQUEST', async () => {
    const { accessToken } = await createUserWithToken();
    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(socket, 'connect');

    const errorPromise = waitForEvent(socket, SOCKET_EVENTS.SESSION_ERROR);
    socket.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: 'not-an-object-id' });
    const err = await errorPromise;
    expect(err.code).toBe('BAD_REQUEST');
    socket.close();
  });

  test('unsubscribing does not error and the socket stays open', async () => {
    const { user, accessToken } = await createUserWithToken();
    const session = await Session.create({ userId: user._id, status: 'active', startedAt: new Date() });

    const socket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(socket, 'connect');
    await emitAck(socket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: session._id.toString() });

    socket.emit(SOCKET_EVENTS.DASHBOARD_UNSUBSCRIBE_SESSION, { sessionId: session._id.toString() });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(socket.connected).toBe(true);
    socket.close();
  });
});
