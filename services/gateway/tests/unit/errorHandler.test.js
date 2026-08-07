const errorHandler = require('../../src/middleware/errorHandler');
const ApiError = require('../../src/utils/ApiError');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mockReq() {
  return { originalUrl: '/api/v1/whatever', method: 'GET', user: { id: 'u1' } };
}

describe('errorHandler', () => {
  test('serializes an ApiError using its own status/code/message', () => {
    const res = mockRes();
    errorHandler(ApiError.badRequest('nope', [{ field: 'x' }]), mockReq(), res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'nope', details: [{ field: 'x' }] },
    });
  });

  test('normalizes a Mongoose ValidationError into a 400 with field details', () => {
    const mongooseErr = {
      name: 'ValidationError',
      errors: {
        email: { path: 'email', message: 'Invalid email address' },
      },
    };
    const res = mockRes();
    errorHandler(mongooseErr, mockReq(), res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.details).toEqual([{ field: 'email', message: 'Invalid email address' }]);
  });

  test('normalizes a Mongoose CastError into a 400', () => {
    const castErr = { name: 'CastError', path: 'sessionId', message: 'Cast failed' };
    const res = mockRes();
    errorHandler(castErr, mockReq(), res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toMatch(/sessionId/);
  });

  test('normalizes a duplicate-key error (11000) into a 409', () => {
    const dupErr = { code: 11000, keyValue: { email: 'a@b.com' } };
    const res = mockRes();
    errorHandler(dupErr, mockReq(), res, jest.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.error.message).toMatch(/email/);
  });

  test('normalizes a JsonWebTokenError into a 401', () => {
    const jwtErr = { name: 'JsonWebTokenError', message: 'jwt malformed' };
    const res = mockRes();
    errorHandler(jwtErr, mockReq(), res, jest.fn());

    expect(res.statusCode).toBe(401);
  });

  test('unknown errors fall back to 500 internal', () => {
    const res = mockRes();
    errorHandler(new Error('totally unexpected'), mockReq(), res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });
});
