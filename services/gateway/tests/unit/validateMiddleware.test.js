const Joi = require('joi');
const validate = require('../../src/middleware/validate');
const ApiError = require('../../src/utils/ApiError');

const schema = Joi.object({
  name: Joi.string().min(2).required(),
  age: Joi.number().integer().min(0),
});

function mockReqRes(body) {
  return { req: { body }, res: {}, next: jest.fn() };
}

describe('validate middleware', () => {
  test('passes through and replaces req[property] with the coerced value', () => {
    const { req, res, next } = mockReqRes({ name: 'Ada', age: '30' });
    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalledWith(); // called with no arguments = success
    expect(req.body).toEqual({ name: 'Ada', age: 30 }); // "30" coerced to a number
  });

  test('strips unknown fields', () => {
    const { req, res, next } = mockReqRes({ name: 'Ada', extra: 'nope' });
    validate(schema)(req, res, next);

    expect(req.body).toEqual({ name: 'Ada' });
    expect(next).toHaveBeenCalledWith();
  });

  test('calls next with a 400 ApiError on validation failure', () => {
    const { req, res, next } = mockReqRes({ age: -1 });
    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(ApiError);
    expect(err.statusCode).toBe(400);
  });

  test('collects every failing field, not just the first', () => {
    const { req, res, next } = mockReqRes({ name: 'A', age: -5 });
    validate(schema)(req, res, next);

    const err = next.mock.calls[0][0];
    const fields = err.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'age']));
  });

  test('validates req.query when given "query" as the property', () => {
    const req = { query: { name: 'Bo' } };
    const next = jest.fn();
    validate(schema, 'query')(req, {}, next);

    expect(req.query).toEqual({ name: 'Bo' });
    expect(next).toHaveBeenCalledWith();
  });
});
