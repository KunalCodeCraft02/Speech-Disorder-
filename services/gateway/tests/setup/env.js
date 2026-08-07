// Runs once per Jest worker, before the test framework is installed and
// before any test file's own top-level `require`s — in particular, before
// `src/config/env.js` (which validates process.env with Joi at *import*
// time) is ever loaded. `MONGO_TEST_URI` is set by tests/helpers/globalSetup.js
// and, per Jest's documented behavior, is inherited by worker processes.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_TEST_URI || 'mongodb://127.0.0.1:27017/gateway-test-placeholder';

process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';

process.env.BCRYPT_SALT_ROUNDS = '4'; // fast hashing — tests don't need production cost
process.env.CORS_ORIGIN = '*';
process.env.LOG_LEVEL = 'error'; // quiet test output
process.env.BODY_LIMIT = '1mb';

// Generous — integration tests fire many requests in quick succession and
// must not trip the same rate limiter production traffic is throttled by.
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.RATE_LIMIT_WINDOW_MS = '900000';

process.env.REDIS_URL = ''; // force Socket.IO's in-memory adapter

// The auth bypass (services/gateway/.env's DISABLE_AUTH, local-dev-only)
// must never leak into the test suite — tests exercise the real
// authenticate()/socketAuth() paths, so this is pinned explicitly rather
// than relying on dotenv's "don't override an existing var" behavior.
process.env.DISABLE_AUTH = 'false';
process.env.DEV_USER_ID = '';

// Deliberately unreachable and fast-failing — DSP connectivity is exercised
// by services/dsp-service's own test suite, not here. dspClient is mocked
// wherever a test path would otherwise open a real connection.
process.env.FASTAPI_WS_URL = 'ws://127.0.0.1:9';
process.env.FASTAPI_REST_URL = 'http://127.0.0.1:9';
process.env.FASTAPI_SERVICE_TOKEN = '';
process.env.DSP_CONNECT_TIMEOUT_MS = '200';
process.env.DSP_CALIBRATION_TIMEOUT_MS = '200';
process.env.DSP_MAX_RECONNECT_ATTEMPTS = '0';
process.env.DSP_RECONNECT_BASE_DELAY_MS = '10';
