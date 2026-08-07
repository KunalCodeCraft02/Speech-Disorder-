const request = require('supertest');
const createApp = require('../../src/app');
const Session = require('../../src/models/Session');
const SpeechMetric = require('../../src/models/SpeechMetric');
const FeedbackEvent = require('../../src/models/FeedbackEvent');
const AnalysisResult = require('../../src/models/AnalysisResult');
const Report = require('../../src/models/Report');
const Notification = require('../../src/models/Notification');
const { createUserWithToken, authHeader } = require('../helpers/factories');
const { waitFor } = require('../helpers/waitFor');
const { ROLES, CLASSIFICATION } = require('../../src/utils/constants');

const app = createApp();

async function createSession(accessToken) {
  const res = await request(app).post('/api/v1/sessions').set(authHeader(accessToken)).send({});
  return res.body.data;
}

describe('POST /api/v1/sessions', () => {
  test('creates an active session owned by the caller', async () => {
    const { user, accessToken } = await createUserWithToken();
    const res = await request(app).post('/api/v1/sessions').set(authHeader(accessToken)).send({});

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(user.id);
    expect(res.body.data.status).toBe('active');
  });
});

describe('GET /api/v1/sessions', () => {
  test('a patient only ever sees their own sessions', async () => {
    const { accessToken: tokenA } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: tokenB } = await createUserWithToken({ role: ROLES.PATIENT });
    await createSession(tokenA);
    await createSession(tokenB);

    const res = await request(app).get('/api/v1/sessions').set(authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  test('a clinician can list any patient sessions by userId', async () => {
    const { user: patient, accessToken: patientToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    await createSession(patientToken);

    const res = await request(app)
      .get('/api/v1/sessions')
      .query({ userId: patient.id })
      .set(authHeader(clinicianToken));

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });
});

describe('GET /api/v1/sessions/:id', () => {
  test('404s for a nonexistent session', async () => {
    const { accessToken } = await createUserWithToken();
    const res = await request(app).get('/api/v1/sessions/64a1b2c3d4e5f6a7b8c9d0e1').set(authHeader(accessToken));
    expect(res.status).toBe(404);
  });

  test('403s when a different patient requests it', async () => {
    const { accessToken: ownerToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: otherToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const session = await createSession(ownerToken);

    const res = await request(app).get(`/api/v1/sessions/${session._id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });

  test('a clinician can access any session', async () => {
    const { accessToken: ownerToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const session = await createSession(ownerToken);

    const res = await request(app).get(`/api/v1/sessions/${session._id}`).set(authHeader(clinicianToken));
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/v1/sessions/:id', () => {
  test('updates notes without changing status', async () => {
    const { accessToken } = await createUserWithToken();
    const session = await createSession(accessToken);

    const res = await request(app)
      .patch(`/api/v1/sessions/${session._id}`)
      .set(authHeader(accessToken))
      .send({ notes: 'felt good today' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('felt good today');
    expect(res.body.data.status).toBe('active');
  });

  test('ending a session computes the summary and the full analysis/report/notification pipeline', async () => {
    const { user, accessToken } = await createUserWithToken();
    const session = await createSession(accessToken);

    await SpeechMetric.insertMany([
      {
        sessionId: session._id,
        articulationRateSPS: 6.2,
        speechRateWPM: 700,
        pauseRatio: 0.12,
        classification: CLASSIFICATION.TACHYLALIA,
        confidence: 0.8,
      },
      {
        sessionId: session._id,
        articulationRateSPS: 5.9,
        speechRateWPM: 690,
        pauseRatio: 0.14,
        classification: CLASSIFICATION.TACHYLALIA,
        confidence: 0.82,
      },
      {
        sessionId: session._id,
        articulationRateSPS: 4.1,
        speechRateWPM: 480,
        pauseRatio: 0.2,
        classification: CLASSIFICATION.NORMAL,
        confidence: 0.7,
      },
    ]);
    await FeedbackEvent.create({ sessionId: session._id, reason: CLASSIFICATION.TACHYLALIA, pattern: [80, 40, 80] });

    const res = await request(app)
      .patch(`/api/v1/sessions/${session._id}`)
      .set(authHeader(accessToken))
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.summary.tachylaliaEvents).toBe(1);
    expect(res.body.data.summary.avgArticulationRateSPS).toBeCloseTo((6.2 + 5.9 + 4.1) / 3, 1);

    // The rest happens fire-and-forget after the response — poll for it.
    const analysisResult = await waitFor(async () => {
      const found = await AnalysisResult.findOne({ sessionId: session._id, type: 'session_final' });
      if (!found) throw new Error('analysis result not generated yet');
      return found;
    });
    expect(analysisResult.overallClassification).toBe(CLASSIFICATION.TACHYLALIA);
    expect(analysisResult.tachylaliaEvents).toBe(1);

    const report = await waitFor(async () => {
      const found = await Report.findOne({ sessionIds: session._id });
      if (!found) throw new Error('report not generated yet');
      return found;
    });
    expect(report.status).toBe('finalized');
    expect(report.userId.toString()).toBe(user.id);

    const notifications = await waitFor(async () => {
      const found = await Notification.find({ userId: user.id }).sort({ createdAt: 1 });
      if (found.length < 2) throw new Error('notifications not generated yet');
      return found;
    });
    const types = notifications.map((n) => n.type).sort();
    expect(types).toEqual(['report_ready', 'session_completed']);
  });

  test('aborting a session sets status without triggering the completion pipeline', async () => {
    const { accessToken } = await createUserWithToken();
    const session = await createSession(accessToken);

    const res = await request(app)
      .patch(`/api/v1/sessions/${session._id}`)
      .set(authHeader(accessToken))
      .send({ status: 'aborted' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('aborted');

    await new Promise((resolve) => setTimeout(resolve, 200));
    const analysisResult = await AnalysisResult.findOne({ sessionId: session._id });
    expect(analysisResult).toBeNull();
  });

  test('rejects setting status to "active" via PATCH (only completed/aborted are allowed)', async () => {
    const { accessToken } = await createUserWithToken();
    const session = await createSession(accessToken);

    const res = await request(app)
      .patch(`/api/v1/sessions/${session._id}`)
      .set(authHeader(accessToken))
      .send({ status: 'active' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/sessions/:id/metrics and /events', () => {
  test('returns persisted metrics and feedback events', async () => {
    const { accessToken } = await createUserWithToken();
    const session = await createSession(accessToken);

    await SpeechMetric.create({
      sessionId: session._id,
      articulationRateSPS: 4.5,
      speechRateWPM: 550,
      pauseRatio: 0.18,
      classification: CLASSIFICATION.NORMAL,
    });
    await FeedbackEvent.create({ sessionId: session._id, reason: CLASSIFICATION.BRADYLALIA, pattern: [300] });

    const metricsRes = await request(app).get(`/api/v1/sessions/${session._id}/metrics`).set(authHeader(accessToken));
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.data.items).toHaveLength(1);

    const eventsRes = await request(app).get(`/api/v1/sessions/${session._id}/events`).set(authHeader(accessToken));
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.body.data).toHaveLength(1);
    expect(eventsRes.body.data[0].reason).toBe('bradylalia');
  });
});

// Confirms the model constraints from the earlier "Generate the MongoDB
// database" work actually hold under a real (in-memory) MongoDB engine.
describe('Session model constraints', () => {
  test('rejects an invalid status value', async () => {
    const { user } = await createUserWithToken();
    await expect(Session.create({ userId: user._id, status: 'not-a-real-status' })).rejects.toThrow();
  });
});
