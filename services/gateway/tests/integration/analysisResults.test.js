const request = require('supertest');
const createApp = require('../../src/app');
const Session = require('../../src/models/Session');
const AnalysisResult = require('../../src/models/AnalysisResult');
const { createUserWithToken, authHeader } = require('../helpers/factories');
const { ROLES, CLASSIFICATION } = require('../../src/utils/constants');

const app = createApp();

async function createSessionDoc(userId) {
  return Session.create({ userId, status: 'completed', startedAt: new Date(), endedAt: new Date() });
}

describe('POST /api/v1/analysis-results', () => {
  test('a clinician can create a manual analysis result for a session', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const session = await createSessionDoc(patient._id);

    const res = await request(app)
      .post('/api/v1/analysis-results')
      .set(authHeader(clinicianToken))
      .send({ sessionId: session._id.toString(), overallClassification: CLASSIFICATION.NORMAL, severity: 'none' });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(patient.id);
    expect(res.body.data.generatedBy).toBe('clinician');
  });

  test('a patient cannot create an analysis result', async () => {
    const { user: patient, accessToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const session = await createSessionDoc(patient._id);

    const res = await request(app)
      .post('/api/v1/analysis-results')
      .set(authHeader(accessToken))
      .send({ sessionId: session._id.toString(), overallClassification: CLASSIFICATION.NORMAL });

    expect(res.status).toBe(403);
  });

  test('404s when the referenced session does not exist', async () => {
    const { accessToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const res = await request(app)
      .post('/api/v1/analysis-results')
      .set(authHeader(accessToken))
      .send({ sessionId: '64a1b2c3d4e5f6a7b8c9d0e1', overallClassification: CLASSIFICATION.NORMAL });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/analysis-results', () => {
  test('a patient only ever sees their own results, regardless of query params', async () => {
    const { user: patientA, accessToken: tokenA } = await createUserWithToken({ role: ROLES.PATIENT });
    const { user: patientB } = await createUserWithToken({ role: ROLES.PATIENT });
    const sessionA = await createSessionDoc(patientA._id);
    const sessionB = await createSessionDoc(patientB._id);

    await AnalysisResult.create({
      sessionId: sessionA._id,
      userId: patientA._id,
      overallClassification: CLASSIFICATION.NORMAL,
    });
    await AnalysisResult.create({
      sessionId: sessionB._id,
      userId: patientB._id,
      overallClassification: CLASSIFICATION.NORMAL,
    });

    const res = await request(app)
      .get('/api/v1/analysis-results')
      .query({ userId: patientB.id }) // patient A tries to snoop on patient B — ignored server-side
      .set(authHeader(tokenA));

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].userId).toBe(patientA.id);
  });
});

describe('GET /api/v1/analysis-results/:id', () => {
  test('403s when a different patient requests it', async () => {
    const { user: owner } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: otherToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const session = await createSessionDoc(owner._id);
    const result = await AnalysisResult.create({
      sessionId: session._id,
      userId: owner._id,
      overallClassification: CLASSIFICATION.NORMAL,
    });

    const res = await request(app).get(`/api/v1/analysis-results/${result._id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });

  test('404s for a nonexistent id', async () => {
    const { accessToken } = await createUserWithToken();
    const res = await request(app).get('/api/v1/analysis-results/64a1b2c3d4e5f6a7b8c9d0e1').set(authHeader(accessToken));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/analysis-results/:id', () => {
  test('a patient cannot delete — the route is clinician/admin only', async () => {
    const { user: owner, accessToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const session = await createSessionDoc(owner._id);
    const result = await AnalysisResult.create({
      sessionId: session._id,
      userId: owner._id,
      overallClassification: CLASSIFICATION.NORMAL,
    });

    const res = await request(app).delete(`/api/v1/analysis-results/${result._id}`).set(authHeader(accessToken));
    expect(res.status).toBe(403);
  });

  test('a clinician can delete an analysis result', async () => {
    const { user: owner } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const session = await createSessionDoc(owner._id);
    const result = await AnalysisResult.create({
      sessionId: session._id,
      userId: owner._id,
      overallClassification: CLASSIFICATION.NORMAL,
    });

    const res = await request(app).delete(`/api/v1/analysis-results/${result._id}`).set(authHeader(clinicianToken));
    expect(res.status).toBe(204);
    expect(await AnalysisResult.findById(result._id)).toBeNull();
  });
});
