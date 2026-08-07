const { FakeDspSessionConnection } = require('./fakeDspClient');

jest.mock('../../src/services/dspClient', () => ({
  DspSessionConnection: require('./fakeDspClient').FakeDspSessionConnection,
}));

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

describe('device <-> gateway <-> dashboard wiring', () => {
  test('a dashboard subscribed to the user room sees session:started when the phone starts a session', async () => {
    const { user, accessToken } = await createUserWithToken();

    const dashboardSocket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(dashboardSocket, 'connect');
    await emitAck(dashboardSocket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_USER, { userId: user.id });

    const startedPromise = waitForEvent(dashboardSocket, SOCKET_EVENTS.SESSION_STARTED);

    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, {});

    const started = await startedPromise;
    expect(started.sessionId).toBe(startAck.sessionId);
    expect(started.userId).toBe(user.id);

    deviceSocket.close();
    dashboardSocket.close();
  });

  test('a metrics frame from the DSP link is broadcast to subscribed dashboards', async () => {
    const { accessToken } = await createUserWithToken();

    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, {});

    const dashboardSocket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(dashboardSocket, 'connect');
    await emitAck(dashboardSocket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: startAck.sessionId });

    const metricsPromise = waitForEvent(dashboardSocket, SOCKET_EVENTS.METRICS_UPDATE);

    // Simulate the DSP service pushing a metrics frame for this session.
    const fakeConn = FakeDspSessionConnection.latest();
    fakeConn.emit('metrics', {
      ts: new Date().toISOString(),
      elapsedSec: 4.2,
      articulationRateSPS: 4.5,
      speechRateWPM: 550,
      pauseRatio: 0.18,
      classification: 'normal',
      confidence: 0.9,
      triggerFeedback: false,
      feedbackReason: null,
    });

    const metrics = await metricsPromise;
    expect(metrics.sessionId).toBe(startAck.sessionId);
    expect(metrics.articulationRateSPS).toBe(4.5);
    expect(metrics.classification).toBe('normal');

    deviceSocket.close();
    dashboardSocket.close();
  });

  test('a feedback-triggering metrics frame fans out to the dashboard (feedback:logged) and the phone (vibration:command)', async () => {
    const { accessToken } = await createUserWithToken();

    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, {});

    const dashboardSocket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(dashboardSocket, 'connect');
    await emitAck(dashboardSocket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: startAck.sessionId });

    const feedbackPromise = waitForEvent(dashboardSocket, SOCKET_EVENTS.FEEDBACK_LOGGED);
    const vibrationPromise = waitForEvent(deviceSocket, SOCKET_EVENTS.VIBRATION_COMMAND);

    const fakeConn = FakeDspSessionConnection.latest();
    fakeConn.emit('metrics', {
      ts: new Date().toISOString(),
      elapsedSec: 6.0,
      articulationRateSPS: 7.2,
      speechRateWPM: 900,
      pauseRatio: 0.05,
      classification: 'tachylalia',
      confidence: 0.95,
      triggerFeedback: true,
      feedbackReason: 'tachylalia',
    });

    const feedback = await feedbackPromise;
    expect(feedback.sessionId).toBe(startAck.sessionId);
    expect(feedback.reason).toBe('tachylalia');

    const vibration = await vibrationPromise;
    expect(vibration.reason).toBe('tachylalia');
    expect(Array.isArray(vibration.pattern)).toBe(true);

    deviceSocket.close();
    dashboardSocket.close();
  });

  test('disorderMode from session:start is echoed on session:started and selects the bradylalia vibration pattern', async () => {
    const { user, accessToken } = await createUserWithToken();

    const dashboardSocket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(dashboardSocket, 'connect');
    await emitAck(dashboardSocket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_USER, { userId: user.id });
    const startedPromise = waitForEvent(dashboardSocket, SOCKET_EVENTS.SESSION_STARTED);

    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, { disorderMode: 'bradylalia' });
    expect(startAck.disorderMode).toBe('bradylalia');

    const started = await startedPromise;
    expect(started.disorderMode).toBe('bradylalia');

    await emitAck(dashboardSocket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: startAck.sessionId });

    const vibrationPromise = waitForEvent(deviceSocket, SOCKET_EVENTS.VIBRATION_COMMAND);

    const fakeConn = FakeDspSessionConnection.latest();
    fakeConn.emit('metrics', {
      ts: new Date().toISOString(),
      elapsedSec: 6.0,
      articulationRateSPS: 1.2,
      classification: 'bradylalia',
      confidence: 0.9,
      triggerFeedback: true,
      feedbackReason: 'bradylalia',
      zRate: -3.1,
      zPause: -1.0,
      zSyll: -0.5,
      compositeZ: -2.4,
      sampleSufficient: true,
    });

    const vibration = await vibrationPromise;
    expect(vibration.pattern).toEqual([300, 150, 300]); // bradylalia pattern, per disorderMode -- not the tachylalia one

    deviceSocket.close();
    dashboardSocket.close();
  });

  test('widened metrics fields (z-scores, sampleSufficient, new derived params) reach the dashboard', async () => {
    const { accessToken } = await createUserWithToken();

    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, {});

    const dashboardSocket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(dashboardSocket, 'connect');
    await emitAck(dashboardSocket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: startAck.sessionId });

    const metricsPromise = waitForEvent(dashboardSocket, SOCKET_EVENTS.METRICS_UPDATE);

    const fakeConn = FakeDspSessionConnection.latest();
    fakeConn.emit('metrics', {
      ts: new Date().toISOString(),
      elapsedSec: 4.2,
      articulationRateSPS: 4.5,
      classification: 'normal',
      confidence: 0.6,
      triggerFeedback: false,
      feedbackReason: null,
      zRate: 0.4,
      zPause: 0.1,
      zSyll: -0.2,
      compositeZ: 0.2,
      sampleSufficient: true,
      wordsPerLast30Sec: 12.5,
      totalSyllablesSession: 88,
      totalWordsSession: 62.9,
      rateTrend: 0.05,
      timeInAbnormalStateSec: 0,
      recoveryTimeSec: null,
      loudnessVariabilityDb: 2.1,
      meanPitchTrendHz: -0.3,
    });

    const metrics = await metricsPromise;
    expect(metrics.zRate).toBe(0.4);
    expect(metrics.compositeZ).toBe(0.2);
    expect(metrics.sampleSufficient).toBe(true);
    expect(metrics.wordsPerLast30Sec).toBe(12.5);
    expect(metrics.totalSyllablesSession).toBe(88);
    expect(metrics.rateTrend).toBe(0.05);

    deviceSocket.close();
    dashboardSocket.close();
  });

  test('session:stop broadcasts session:ended with the summary to subscribed dashboards', async () => {
    const { accessToken } = await createUserWithToken();

    const deviceSocket = connectClient(server.port, SOCKET_NAMESPACES.DEVICE, accessToken);
    await waitForEvent(deviceSocket, 'connect');
    const startAck = await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_START, {});

    const dashboardSocket = connectClient(server.port, SOCKET_NAMESPACES.DASHBOARD, accessToken);
    await waitForEvent(dashboardSocket, 'connect');
    await emitAck(dashboardSocket, SOCKET_EVENTS.DASHBOARD_SUBSCRIBE_SESSION, { sessionId: startAck.sessionId });

    const endedPromise = waitForEvent(dashboardSocket, SOCKET_EVENTS.SESSION_ENDED);
    await emitAck(deviceSocket, SOCKET_EVENTS.SESSION_STOP, {});

    const ended = await endedPromise;
    expect(ended.sessionId).toBe(startAck.sessionId);
    expect(ended.summary).toBeDefined();

    deviceSocket.close();
    dashboardSocket.close();
  });
});
