const notFound = require('../../src/middleware/notFound');
const ApiError = require('../../src/utils/ApiError');

describe('notFound middleware', () => {
  test('forwards a 404 ApiError naming the unmatched path', () => {
    const req = { originalUrl: '/api/v1/does-not-exist' };
    const next = jest.fn();

    notFound(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toMatch('/api/v1/does-not-exist');
  });
});
