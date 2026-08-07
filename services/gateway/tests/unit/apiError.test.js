const ApiError = require('../../src/utils/ApiError');

describe('ApiError', () => {
  test('badRequest sets status 400 and code', () => {
    const err = ApiError.badRequest('bad input', [{ field: 'x' }]);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.details).toEqual([{ field: 'x' }]);
    expect(err.isOperational).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  test('unauthorized defaults message and sets status 401', () => {
    const err = ApiError.unauthorized();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('Unauthorized');
  });

  test('forbidden sets status 403', () => {
    expect(ApiError.forbidden().statusCode).toBe(403);
  });

  test('notFound sets status 404', () => {
    expect(ApiError.notFound().statusCode).toBe(404);
  });

  test('conflict sets status 409', () => {
    const err = ApiError.conflict('dup', { field: 'email' });
    expect(err.statusCode).toBe(409);
    expect(err.details).toEqual({ field: 'email' });
  });

  test('internal is non-operational and sets status 500', () => {
    const err = ApiError.internal();
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(false);
  });

  test('custom constructor picks a default code from the status map', () => {
    const err = new ApiError(422, 'nope');
    expect(err.code).toBe('UNPROCESSABLE_ENTITY');
  });

  test('unknown status code falls back to INTERNAL code', () => {
    const err = new ApiError(418, 'teapot');
    expect(err.code).toBe('INTERNAL');
  });

  test('explicit isOperational: false is respected even for 4xx', () => {
    const err = new ApiError(400, 'weird', { isOperational: false });
    expect(err.isOperational).toBe(false);
  });
});
