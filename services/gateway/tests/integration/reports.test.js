const request = require('supertest');
const createApp = require('../../src/app');
const Session = require('../../src/models/Session');
const SpeechMetric = require('../../src/models/SpeechMetric');
const Report = require('../../src/models/Report');
const Notification = require('../../src/models/Notification');
const { createUserWithToken, authHeader } = require('../helpers/factories');
const { ROLES, CLASSIFICATION } = require('../../src/utils/constants');

const app = createApp();

async function createSessionDoc(userId, { withMetrics = true } = {}) {
  const session = await Session.create({ userId, status: 'completed', startedAt: new Date(), endedAt: new Date() });
  if (withMetrics) {
    await SpeechMetric.create({
      sessionId: session._id,
      articulationRateSPS: 4.3,
      speechRateWPM: 560,
      pauseRatio: 0.18,
      classification: CLASSIFICATION.NORMAL,
      confidence: 0.9,
    });
  }
  return session;
}

describe('POST /api/v1/reports', () => {
  test('a clinician can draft a report referencing real sessions', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const session = await createSessionDoc(patient._id);

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'Progress Note', sessionIds: [session._id.toString()] });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.title).toBe('Progress Note');
  });

  test('400s when a referenced sessionId does not exist', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'Bad Report', sessionIds: ['64a1b2c3d4e5f6a7b8c9d0e1'] });

    expect(res.status).toBe(400);
  });

  test('a patient cannot create a report', async () => {
    const { user: patient, accessToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const res = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(accessToken))
      .send({ userId: patient.id, title: 'Self Report' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/reports', () => {
  test('a patient only ever sees their own reports', async () => {
    const { user: patientA, accessToken: tokenA } = await createUserWithToken({ role: ROLES.PATIENT });
    const { user: patientB } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    await request(app).post('/api/v1/reports').set(authHeader(clinicianToken)).send({ userId: patientA.id, title: 'A' });
    await request(app).post('/api/v1/reports').set(authHeader(clinicianToken)).send({ userId: patientB.id, title: 'B' });

    const res = await request(app).get('/api/v1/reports').set(authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].title).toBe('A');
  });
});

describe('GET /api/v1/reports/:id access control', () => {
  test('an unrelated patient cannot read someone else report', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const { accessToken: strangerToken } = await createUserWithToken({ role: ROLES.PATIENT });

    const createRes = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'Private' });

    const res = await request(app).get(`/api/v1/reports/${createRes.body.data._id}`).set(authHeader(strangerToken));
    expect(res.status).toBe(403);
  });

  test('a report shared with a user becomes accessible to them', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const { user: sharedWithUser, accessToken: sharedToken } = await createUserWithToken({ role: ROLES.PATIENT });

    const createRes = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'Shared Report' });
    const reportId = createRes.body.data._id;

    const forbiddenRes = await request(app).get(`/api/v1/reports/${reportId}`).set(authHeader(sharedToken));
    expect(forbiddenRes.status).toBe(403);

    const shareRes = await request(app)
      .post(`/api/v1/reports/${reportId}/share`)
      .set(authHeader(clinicianToken))
      .send({ userId: sharedWithUser.id });
    expect(shareRes.status).toBe(200);

    const allowedRes = await request(app).get(`/api/v1/reports/${reportId}`).set(authHeader(sharedToken));
    expect(allowedRes.status).toBe(200);
  });
});

describe('PATCH /api/v1/reports/:id', () => {
  test('finalizing a draft report sets generatedAt and fires a report_ready notification', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    const createRes = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'To Finalize' });
    const reportId = createRes.body.data._id;

    const res = await request(app)
      .patch(`/api/v1/reports/${reportId}`)
      .set(authHeader(clinicianToken))
      .send({ status: 'finalized' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('finalized');
    expect(res.body.data.generatedAt).toBeTruthy();

    const notification = await Notification.findOne({ userId: patient._id, type: 'report_ready' });
    expect(notification).not.toBeNull();
  });

  test('a clinician who did not author the report can still update it', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: authorToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const { accessToken: otherClinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    const createRes = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(authorToken))
      .send({ userId: patient.id, title: 'Team Report' });

    const res = await request(app)
      .patch(`/api/v1/reports/${createRes.body.data._id}`)
      .set(authHeader(otherClinicianToken))
      .send({ summary: 'Reviewed by a colleague.' });
    expect(res.status).toBe(200);
  });

  test('a patient cannot update a report about themselves', async () => {
    const { user: patient, accessToken: patientToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    const createRes = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'Not Yours' });

    const res = await request(app)
      .patch(`/api/v1/reports/${createRes.body.data._id}`)
      .set(authHeader(patientToken))
      .send({ summary: 'trying to edit' });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/reports/sessions/:sessionId/generate + GET download', () => {
  test('generates a real PDF, stores it, and it can be downloaded', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const session = await createSessionDoc(patient._id);

    const generateRes = await request(app)
      .post(`/api/v1/reports/sessions/${session._id}/generate`)
      .set(authHeader(clinicianToken))
      .send({});

    expect(generateRes.status).toBe(201);
    expect(generateRes.body.data.status).toBe('finalized');
    expect(generateRes.body.data.pdf.data).toBeUndefined(); // binary is never inlined into the JSON response
    expect(generateRes.body.data.pdf.size).toBeGreaterThan(0);
    const reportId = generateRes.body.data._id;

    const downloadRes = await request(app)
      .get(`/api/v1/reports/${reportId}/download`)
      .set(authHeader(clinicianToken));

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers['content-type']).toBe('application/pdf');
    expect(downloadRes.headers['content-disposition']).toMatch(/^attachment; filename="/);
    expect(Buffer.isBuffer(downloadRes.body)).toBe(true);
    expect(downloadRes.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  test('regenerating for the same session updates the same report id', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const session = await createSessionDoc(patient._id);

    const first = await request(app)
      .post(`/api/v1/reports/sessions/${session._id}/generate`)
      .set(authHeader(clinicianToken))
      .send({});
    const second = await request(app)
      .post(`/api/v1/reports/sessions/${session._id}/generate`)
      .set(authHeader(clinicianToken))
      .send({ title: 'Regenerated Title' });

    expect(second.body.data._id).toBe(first.body.data._id);
    expect(second.body.data.title).toBe('Regenerated Title');
  });

  test('downloading a report before it has been generated returns 400', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    const draftRes = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'No PDF Yet' });

    const res = await request(app)
      .get(`/api/v1/reports/${draftRes.body.data._id}/download`)
      .set(authHeader(clinicianToken));
    expect(res.status).toBe(400);
  });

  test('a stranger cannot download a report they have no access to', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });
    const { accessToken: strangerToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const session = await createSessionDoc(patient._id);

    const generateRes = await request(app)
      .post(`/api/v1/reports/sessions/${session._id}/generate`)
      .set(authHeader(clinicianToken))
      .send({});

    const res = await request(app)
      .get(`/api/v1/reports/${generateRes.body.data._id}/download`)
      .set(authHeader(strangerToken));
    expect(res.status).toBe(403);
  });

  test('a patient cannot trigger generation themselves — clinician/admin only', async () => {
    const { user: patient, accessToken: patientToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const session = await createSessionDoc(patient._id);

    const res = await request(app)
      .post(`/api/v1/reports/sessions/${session._id}/generate`)
      .set(authHeader(patientToken))
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/reports/:id', () => {
  test('the author can delete their own draft report', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    const createRes = await request(app)
      .post('/api/v1/reports')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'Delete Me' });

    const res = await request(app).delete(`/api/v1/reports/${createRes.body.data._id}`).set(authHeader(clinicianToken));
    expect(res.status).toBe(204);
    expect(await Report.findById(createRes.body.data._id)).toBeNull();
  });
});
