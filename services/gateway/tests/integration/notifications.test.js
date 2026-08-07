const request = require('supertest');
const createApp = require('../../src/app');
const Notification = require('../../src/models/Notification');
const { createUserWithToken, authHeader } = require('../helpers/factories');
const { ROLES } = require('../../src/utils/constants');

const app = createApp();

describe('POST /api/v1/notifications', () => {
  test('a clinician can send a notification to a patient', async () => {
    const { user: patient } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken: clinicianToken } = await createUserWithToken({ role: ROLES.CLINICIAN });

    const res = await request(app)
      .post('/api/v1/notifications')
      .set(authHeader(clinicianToken))
      .send({ userId: patient.id, title: 'Reminder', message: 'Please complete your session today.' });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(patient.id);
    expect(res.body.data.read).toBe(false);
  });

  test('a patient cannot send a notification', async () => {
    const { user: target } = await createUserWithToken({ role: ROLES.PATIENT });
    const { accessToken } = await createUserWithToken({ role: ROLES.PATIENT });

    const res = await request(app)
      .post('/api/v1/notifications')
      .set(authHeader(accessToken))
      .send({ userId: target.id, title: 'x', message: 'y' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/notifications', () => {
  test('only returns the caller own notifications, with an unread count', async () => {
    const { user: userA, accessToken: tokenA } = await createUserWithToken();
    const { user: userB } = await createUserWithToken();

    await Notification.create({ userId: userA._id, type: 'system', title: 'A1', message: 'hi' });
    await Notification.create({ userId: userA._id, type: 'system', title: 'A2', message: 'hi', read: true });
    await Notification.create({ userId: userB._id, type: 'system', title: 'B1', message: 'hi' });

    const res = await request(app).get('/api/v1/notifications').set(authHeader(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.unreadCount).toBe(1);
  });

  test('supports filtering by read state', async () => {
    const { user, accessToken } = await createUserWithToken();
    await Notification.create({ userId: user._id, type: 'system', title: 'Unread', message: 'hi' });
    await Notification.create({ userId: user._id, type: 'system', title: 'Read', message: 'hi', read: true });

    const res = await request(app).get('/api/v1/notifications').query({ read: 'false' }).set(authHeader(accessToken));
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].title).toBe('Unread');
  });
});

describe('PATCH /api/v1/notifications/:id/read', () => {
  test('marks the caller own notification read', async () => {
    const { user, accessToken } = await createUserWithToken();
    const notification = await Notification.create({ userId: user._id, type: 'system', title: 'x', message: 'y' });

    const res = await request(app).patch(`/api/v1/notifications/${notification._id}/read`).set(authHeader(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);
    expect(res.body.data.readAt).toBeTruthy();
  });

  test('a different user cannot mark someone else notification read', async () => {
    const { user: owner } = await createUserWithToken();
    const { accessToken: otherToken } = await createUserWithToken();
    const notification = await Notification.create({ userId: owner._id, type: 'system', title: 'x', message: 'y' });

    const res = await request(app).patch(`/api/v1/notifications/${notification._id}/read`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/v1/notifications/read-all', () => {
  test('marks every unread notification for the caller as read', async () => {
    const { user, accessToken } = await createUserWithToken();
    await Notification.create({ userId: user._id, type: 'system', title: 'a', message: 'hi' });
    await Notification.create({ userId: user._id, type: 'system', title: 'b', message: 'hi' });

    const res = await request(app).post('/api/v1/notifications/read-all').set(authHeader(accessToken));
    expect(res.status).toBe(204);

    const remaining = await Notification.countDocuments({ userId: user._id, read: false });
    expect(remaining).toBe(0);
  });
});

describe('DELETE /api/v1/notifications/:id', () => {
  test('the owner can delete their own notification', async () => {
    const { user, accessToken } = await createUserWithToken();
    const notification = await Notification.create({ userId: user._id, type: 'system', title: 'x', message: 'y' });

    const res = await request(app).delete(`/api/v1/notifications/${notification._id}`).set(authHeader(accessToken));
    expect(res.status).toBe(204);
    expect(await Notification.findById(notification._id)).toBeNull();
  });

  test('a non-owner gets 403, not a silent success', async () => {
    const { user: owner } = await createUserWithToken();
    const { accessToken: otherToken } = await createUserWithToken();
    const notification = await Notification.create({ userId: owner._id, type: 'system', title: 'x', message: 'y' });

    const res = await request(app).delete(`/api/v1/notifications/${notification._id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
    expect(await Notification.findById(notification._id)).not.toBeNull();
  });
});
