const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  test('calls through to the wrapped handler with (req, res, next)', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    const req = {};
    const res = {};
    const next = jest.fn();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('forwards a rejected promise to next() instead of throwing', async () => {
    const error = new Error('boom');
    const handler = jest.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(handler);
    const next = jest.fn();

    await wrapped({}, {}, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  test('a synchronous throw inside an async handler is still caught', async () => {
    const error = new Error('sync boom');
    // eslint-disable-next-line require-await
    const handler = async () => {
      throw error;
    };
    const wrapped = asyncHandler(handler);
    const next = jest.fn();

    await wrapped({}, {}, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
