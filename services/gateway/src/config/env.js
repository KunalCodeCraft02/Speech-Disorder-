const path = require('path');
const dotenv = require('dotenv');
const Joi = require('joi');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(4000),

  MONGO_URI: Joi.string().uri().required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

  BCRYPT_SALT_ROUNDS: Joi.number().default(12),

  CORS_ORIGIN: Joi.string().default('*'),

  FASTAPI_WS_URL: Joi.string().uri().default('ws://localhost:8000'),
  FASTAPI_REST_URL: Joi.string().uri().default('http://localhost:8000'),
  FASTAPI_SERVICE_TOKEN: Joi.string().allow('').default(''),
  DSP_CONNECT_TIMEOUT_MS: Joi.number().default(5000),
  // /calibrate runs the full DSP pipeline (preprocess/VAD/pitch/nuclei) once
  // per whole clip *and* once per 4s sub-window, across every submitted clip
  // (Part A.2) -- a real ~20-40s recording is genuinely CPU-heavy to
  // process, unlike opening a connection, so this gets its own, much more
  // generous budget instead of reusing DSP_CONNECT_TIMEOUT_MS.
  DSP_CALIBRATION_TIMEOUT_MS: Joi.number().default(30000),
  // Defaults sized to survive a Render free-tier cold start (DSP service
  // spun down after 15min idle can take 30-60s to wake and starts
  // answering the WS upgrade with 502s until it's ready) -- not just a
  // same-host "is the process up" retry budget. Base delay doubles each
  // attempt up to the cap, so with these defaults (1s, 2s, 4s, 8s, 8s...)
  // 10 attempts gives ~63s of total runway before giving up.
  DSP_MAX_RECONNECT_ATTEMPTS: Joi.number().default(10),
  DSP_RECONNECT_BASE_DELAY_MS: Joi.number().default(1000),
  DSP_RECONNECT_MAX_DELAY_MS: Joi.number().default(8000),

  REDIS_URL: Joi.string().uri().allow('').default(''),

  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'debug').default('info'),

  RATE_LIMIT_WINDOW_MS: Joi.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: Joi.number().default(300),
  AUTH_RATE_LIMIT_MAX: Joi.number().default(20),

  BODY_LIMIT: Joi.string().default('1mb'),

  // Local-dev convenience: skips JWT verification entirely (REST + sockets)
  // and treats every request as DEV_USER_ID below. Never enable this outside
  // a local/demo environment — it removes all authentication.
  DISABLE_AUTH: Joi.boolean().default(false),
  DEV_USER_ID: Joi.string().hex().length(24).allow(''),
}).unknown(true);

const { value: envVars, error } = schema.validate(process.env);

if (error) {
  // Fail fast: a misconfigured gateway must never boot silently.
  throw new Error(`Environment validation error: ${error.message}`);
}

module.exports = Object.freeze({
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',
  port: envVars.PORT,

  mongoUri: envVars.MONGO_URI,

  jwt: {
    accessSecret: envVars.JWT_ACCESS_SECRET,
    accessExpiresIn: envVars.JWT_ACCESS_EXPIRES_IN,
    refreshSecret: envVars.JWT_REFRESH_SECRET,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
  },

  bcryptSaltRounds: envVars.BCRYPT_SALT_ROUNDS,

  corsOrigin: envVars.CORS_ORIGIN === '*' ? '*' : envVars.CORS_ORIGIN.split(',').map((o) => o.trim()),

  dsp: {
    wsUrl: envVars.FASTAPI_WS_URL,
    restUrl: envVars.FASTAPI_REST_URL,
    serviceToken: envVars.FASTAPI_SERVICE_TOKEN,
    connectTimeoutMs: envVars.DSP_CONNECT_TIMEOUT_MS,
    calibrationTimeoutMs: envVars.DSP_CALIBRATION_TIMEOUT_MS,
    maxReconnectAttempts: envVars.DSP_MAX_RECONNECT_ATTEMPTS,
    reconnectBaseDelayMs: envVars.DSP_RECONNECT_BASE_DELAY_MS,
    reconnectMaxDelayMs: envVars.DSP_RECONNECT_MAX_DELAY_MS,
  },

  redisUrl: envVars.REDIS_URL || null,

  logLevel: envVars.LOG_LEVEL,

  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    max: envVars.RATE_LIMIT_MAX,
    authMax: envVars.AUTH_RATE_LIMIT_MAX,
  },

  bodyLimit: envVars.BODY_LIMIT,

  disableAuth: envVars.DISABLE_AUTH,
  devUserId: envVars.DEV_USER_ID || null,
});
