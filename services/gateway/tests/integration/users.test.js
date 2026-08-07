jest.mock('../../src/services/dspRestClient');

const request = require('supertest');
const createApp = require('../../src/app');
const dspRestClient = require('../../src/services/dspRestClient');
const { createUserWithToken, authHeader } = require('../helpers/factories');
const { ROLES } = require('../../src/utils/constants');

const app = createApp();

describe('GET/PATCH /api/v1/users/me', () => {
  test('returns the authenticated caller profile', async () => {
    const { user, accessToken } = await createUserWithToken({ name: 'Grace Hopper' });
    const res = await request(app).get('/api/v1/users/me').set(authHeader(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, name: 'Grace Hopper' });
  });

  test('updates the caller name', async () => {
    const { accessToken } = await createUserWithToken({ name: 'Old Name' });
    const res = await request(app).patch('/api/v1/users/me').set(authHeader(accessToken)).send({ name: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New Name');
  });

  test('rejects an empty update body', async () => {
    const { accessToken } = await createUserWithToken();
    const res = await request(app).patch('/api/v1/users/me').set(authHeader(accessToken)).send({});
    expect(res.status).toBe(400);
  });
});

describe('GET/PUT /api/v1/users/:id/calibration', () => {
  test('404s when no calibration profile exists yet', async () => {
    const { user, accessToken } = await createUserWithToken();
    const res = await request(app).get(`/api/v1/users/${user.id}/calibration`).set(authHeader(accessToken));
    expect(res.status).toBe(404);
  });

  test('a patient can set and then read back their own calibration', async () => {
    const { user, accessToken } = await createUserWithToken();
    const putRes = await request(app)
      .put(`/api/v1/users/${user.id}/calibration`)
      .set(authHeader(accessToken))
      .send({
        baselineArticulationRate: 4.5,
        baselinePauseRatio: 0.2,
        tachylaliaThreshold: 6.0,
        bradylaliaThreshold: 3.0,
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.data.baselineArticulationRate).toBe(4.5);

    const getRes = await request(app).get(`/api/v1/users/${user.id}/calibration`).set(authHeader(accessToken));
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.tachylaliaThreshold).toBe(6.0);
  });

  test('rejects a bradylalia threshold at or above the tachylalia threshold', async () => {
    const { user, accessToken } = await createUserWithToken();
    const res = await request(app)
      .put(`/api/v1/users/${user.id}/calibration`)
      .set(authHeader(accessToken))
      .send({
        baselineArticulationRate: 4.5,
        baselinePauseRatio: 0.2,
        tachylaliaThreshold: 4.0,
        bradylaliaThreshold: 5.0,
      });
    expect(res.status).toBe(400);
  });

  test('a patient cannot read another patient calibration', async () => {
    const { accessToken } = await createUserWithToken({ role: ROLES.PATIENT });
    const { user: otherUser } = await createUserWithToken({ role: ROLES.PATIENT });

    const res = await request(app).get(`/api/v1/users/${otherUser.id}/calibration`).set(authHeader(accessToken));
    expect(res.status).toBe(403);
  });

  test('a clinician can read a patient calibration', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    await request(app)
      .put(`/api/v1/users/${patient.id}/calibration`)
      .set(authHeader(clinicianToken))
      .send({ baselineArticulationRate: 4.0, baselinePauseRatio: 0.2, tachylaliaThreshold: 5.4, bradylaliaThreshold: 2.6 });

    const res = await request(app).get(`/api/v1/users/${patient.id}/calibration`).set(authHeader(clinicianToken));
    expect(res.status).toBe(200);
  });

  test('recordCalibration calls the DSP client and persists its result', async () => {
    dspRestClient.requestCalibration.mockResolvedValue({
      baselineArticulationRate: 4.7,
      baselinePauseRatio: 0.19,
      tachylaliaThreshold: 6.3,
      bradylaliaThreshold: 3.05,
      baselineSpeechRateWPM: 615,
      baselinePitchHz: 180,
      baselineLoudnessDb: -18,
      baselinePauseDurationSec: 0.4,
      baselineSpeechRatio: 0.78,
      durationSec: 30,
      syllableCount: 120,
    });

    const { user, accessToken } = await createUserWithToken();
    const audioBase64 = Buffer.from('fake pcm16 bytes').toString('base64');

    const res = await request(app)
      .post(`/api/v1/users/${user.id}/calibration/record`)
      .set(authHeader(accessToken))
      .send({ audioBase64, sampleRate: 16000 });

    expect(res.status).toBe(200);
    expect(res.body.data.baselineArticulationRate).toBe(4.7);
    expect(dspRestClient.requestCalibration).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, referenceStats: { audioBase64, sampleRate: 16000 } })
    );
  });

  test('recordCalibration prefers multiple pooled clips over a single audioBase64', async () => {
    dspRestClient.requestCalibration.mockResolvedValue({
      baselineArticulationRate: 4.2,
      baselineArticulationRateStd: 0.5,
      isPersonal: true,
      clipCount: 2,
    });

    const { user, accessToken } = await createUserWithToken();
    const clips = [
      { audioBase64: Buffer.from('clip one').toString('base64'), sampleRate: 16000 },
      { audioBase64: Buffer.from('clip two').toString('base64'), sampleRate: 16000 },
    ];

    const res = await request(app)
      .post(`/api/v1/users/${user.id}/calibration/record`)
      .set(authHeader(accessToken))
      .send({ clips });

    expect(res.status).toBe(200);
    expect(res.body.data.isPersonal).toBe(true);
    expect(dspRestClient.requestCalibration).toHaveBeenCalledWith(expect.objectContaining({ referenceStats: { clips } }));
  });

  test('recalibrating appends to history instead of erasing it', async () => {
    dspRestClient.requestCalibration
      .mockResolvedValueOnce({ baselineArticulationRate: 4.0, baselinePauseRatio: 1.4 })
      .mockResolvedValueOnce({ baselineArticulationRate: 5.0, baselinePauseRatio: 1.6 });

    const { user, accessToken } = await createUserWithToken();
    const audioBase64 = Buffer.from('fake pcm16 bytes').toString('base64');

    await request(app)
      .post(`/api/v1/users/${user.id}/calibration/record`)
      .set(authHeader(accessToken))
      .send({ audioBase64 });

    const second = await request(app)
      .post(`/api/v1/users/${user.id}/calibration/record`)
      .set(authHeader(accessToken))
      .send({ audioBase64 });

    expect(second.body.data.baselineArticulationRate).toBe(5.0); // active fields reflect the latest
    expect(second.body.data.calibrationHistory).toHaveLength(2); // but the first snapshot is still there
    expect(second.body.data.calibrationHistory[0].baselineArticulationRate).toBe(4.0);
    expect(second.body.data.calibrationHistory[1].baselineArticulationRate).toBe(5.0);
  });

  test('a profile with no baseline yet is treated as uncalibrated (404), not an empty 200', async () => {
    dspRestClient.requestCalibration.mockResolvedValue({}); // e.g. a DSP response missing the rate entirely
    const { user, accessToken } = await createUserWithToken();

    await request(app)
      .post(`/api/v1/users/${user.id}/calibration/record`)
      .set(authHeader(accessToken))
      .send({ audioBase64: Buffer.from('x').toString('base64') });

    const res = await request(app).get(`/api/v1/users/${user.id}/calibration`).set(authHeader(accessToken));
    expect(res.status).toBe(404);
  });
});
