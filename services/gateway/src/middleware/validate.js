const ApiError = require('../utils/ApiError');

/**
 * @param {import('joi').ObjectSchema} schema
 * @param {'body'|'query'|'params'} property
 */
const validate = (schema, property = 'body') => (req, res, next) => {
  const { error, value } = schema.validate(req[property], {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details.map((d) => ({ field: d.path.join('.'), message: d.message }));
    return next(ApiError.badRequest('Validation failed', details));
  }

  req[property] = value;
  next();
};

module.exports = validate;
