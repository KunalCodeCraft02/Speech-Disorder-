const request = require('supertest');
const createApp = require('../../src/app');
const User = require('../../src/models/User');

const app = createApp();

describe('POST /api/v1/auth/register', () => {
  test('creates a user and returns a token pair', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Password123!',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', role: 'patient' });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
  });

  test('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/v1/auth/register').send({
      name: 'First',
      email: 'dupe@example.com',
      password: 'Password123!',
    });

    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Second',
      email: 'dupe@example.com',
      password: 'Password123!',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('rejects a password shorter than 8 characters with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Short', email: 'short@example.com', password: 'abc123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  test('never persists the password in plaintext', async () => {
    await request(app).post('/api/v1/auth/register').send({
      name: 'Hashed',
      email: 'hashed@example.com',
      password: 'Password123!',
    });

    const stored = await User.findOne({ email: 'hashed@example.com' }).select('+passwordHash');
    expect(stored.passwordHash).not.toBe('Password123!');
    expect(await stored.comparePassword('Password123!')).toBe(true);
  });

  test('cannot self-register as admin — only patient/clinician are allowed', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      name: 'Wannabe Admin',
      email: 'admin-wannabe@example.com',
      password: 'Password123!',
      role: 'admin',
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/v1/auth/register').send({
      name: 'Login User',
      email: 'login@example.com',
      password: 'Password123!',
    });
  });

  test('succeeds with correct credentials', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'login@example.com', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('login@example.com');
  });

  test('rejects a wrong password with 401', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'login@example.com', password: 'WrongPass1!' });
    expect(res.status).toBe(401);
  });

  test('rejects an unknown email with 401 (not a 404 — no user enumeration)', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'Password123!' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  test('rotates the refresh token and issues a new access token', async () => {
    const registerRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Refresh User',
      email: 'refresh@example.com',
      password: 'Password123!',
    });
    const { refreshToken } = registerRes.body.data;

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).not.toBe(refreshToken);

    // The rotated-out token must now be rejected (single-use rotation).
    const reuseRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuseRes.status).toBe(401);
  });

  test('rejects a garbage refresh token with 401', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });
});

describe('protected routes require a Bearer token', () => {
  test('GET /users/me without a token is 401', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  test('GET /users/me with a malformed header is 401', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Authorization', 'not-bearer-scheme');
    expect(res.status).toBe(401);
  });

  test('GET /users/me with a garbage token is 401', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer garbage.token.value');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('revokes the given refresh token', async () => {
    const registerRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Logout User',
      email: 'logout@example.com',
      password: 'Password123!',
    });
    const { accessToken, refreshToken } = registerRes.body.data;

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });
    expect(res.status).toBe(204);

    const reuseRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuseRes.status).toBe(401);
  });
});
