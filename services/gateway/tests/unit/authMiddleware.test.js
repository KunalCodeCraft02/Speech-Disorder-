jest.mock('../../src/services/tokenService');
jest.mock('../../src/config/env', () => ({ disableAuth: false, devUserId: null }));

const tokenService = require('../../src/services/tokenService');
const env = require('../../src/config/env');
const { authenticate, authorize } = require('../../src/middleware/auth');
const ApiError = require('../../src/utils/ApiError');

function mockRes() {
  return {};
}

describe('authenticate', () => {
  afterEach(() => {
    jest.resetAllMocks();
    env.disableAuth = false;
    env.devUserId = null;
  });

  test('DISABLE_AUTH=true attaches the fixed dev user and skips token verification entirely', () => {
    env.disableAuth = true;
    env.devUserId = 'dev-user-id';
    const req = { headers: {} }; // no Authorization header at all
    const next = jest.fn();
    authenticate(req, mockRes(), next);

    expect(req.user).toEqual({ id: 'dev-user-id', role: 'patient', email: 'dev@local' });
    expect(next).toHaveBeenCalledWith();
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  test('rejects a missing Authorization header', () => {
    const req = { headers: {} };
    const next = jest.fn();
    authenticate(req, mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(401);
  });

  test('rejects a non-Bearer scheme', () => {
    const req = { headers: { authorization: 'Basic abc123' } };
    const next = jest.fn();
    authenticate(req, mockRes(), next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  test('rejects a token tokenService fails to verify', () => {
    tokenService.verifyAccessToken.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const req = { headers: { authorization: 'Bearer bad-token' } };
    const next = jest.fn();
    authenticate(req, mockRes(), next);

    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  test('attaches req.user and calls next() with no error on a valid token', () => {
    tokenService.verifyAccessToken.mockReturnValue({ sub: 'user-1', role: 'clinician', email: 'c@x.com' });
    const req = { headers: { authorization: 'Bearer good-token' } };
    const next = jest.fn();
    authenticate(req, mockRes(), next);

    expect(req.user).toEqual({ id: 'user-1', role: 'clinician', email: 'c@x.com' });
    expect(next).toHaveBeenCalledWith();
  });
});

describe('authorize', () => {
  test('rejects when req.user is missing', () => {
    const next = jest.fn();
    authorize('admin')({}, mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  test('rejects a role not in the allowed list', () => {
    const req = { user: { role: 'patient' } };
    const next = jest.fn();
    authorize('clinician', 'admin')(req, mockRes(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  test('allows a role in the allowed list', () => {
    const req = { user: { role: 'admin' } };
    const next = jest.fn();
    authorize('clinician', 'admin')(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  test('with no roles given, allows any authenticated user', () => {
    const req = { user: { role: 'patient' } };
    const next = jest.fn();
    authorize()(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});
