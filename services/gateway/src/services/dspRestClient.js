const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

function authHeaders() {
  return env.dsp.serviceToken ? { Authorization: `Bearer ${env.dsp.serviceToken}` } : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 502/503/504 are what a Render free-tier DSP instance answers with while it's
// still waking up from a cold start (see DSP_RECONNECT_* comment in env.js) --
// worth retrying. Anything else (4xx, or a 500 the DSP app raised itself) is a
// real failure and retrying it would just delay the same error.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

async function checkHealth() {
  try {
    const res = await fetch(`${env.dsp.restUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch (err) {
    logger.warn('DSP health check failed', { error: err.message });
    return false;
  }
}

/**
 * Asks FastAPI to derive a calibrated baseline from one or more reference
 * clips (or from a prior session's aggregate stats). Returns the same
 * shape stored in the Profile model.
 *
 * FastAPI returns 422 specifically when a submitted recording didn't
 * contain enough actual phonation time (Part A.3) -- that's a
 * patient-actionable "please redo calibration" condition, not a server
 * error, so it's forwarded as a 422 ApiError with FastAPI's own detail
 * message rather than collapsed into a generic 500.
 */
async function requestCalibration({ userId, referenceStats, demoMode }) {
  let attempt = 0;

  for (;;) {
    let res;
    try {
      res = await fetch(`${env.dsp.restUrl}/calibrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, referenceStats, demoMode: Boolean(demoMode) }),
        signal: AbortSignal.timeout(env.dsp.calibrationTimeoutMs),
      });
    } catch (err) {
      if (attempt >= env.dsp.maxReconnectAttempts) {
        logger.warn('DSP calibration request failed', { error: err.message, attempt });
        throw ApiError.internal('Calibration service is unavailable — please try again.');
      }
      await sleep(Math.min(env.dsp.reconnectBaseDelayMs * 2 ** attempt, env.dsp.reconnectMaxDelayMs));
      attempt += 1;
      continue;
    }

    if (res.ok) return res.json();

    const body = await res.json().catch(() => null);
    const detail = body && typeof body.detail === 'string' ? body.detail : undefined;

    if (res.status === 422) {
      throw new ApiError(422, detail || 'Calibration recording did not contain enough speech — please redo it.', {
        code: 'INSUFFICIENT_PHONATION',
      });
    }
    if (res.status === 400) {
      throw ApiError.badRequest(detail || 'Invalid calibration recording.');
    }

    if (RETRYABLE_STATUSES.has(res.status) && attempt < env.dsp.maxReconnectAttempts) {
      logger.info('DSP calibration request hit a cold-start response, retrying', { status: res.status, attempt });
      await sleep(Math.min(env.dsp.reconnectBaseDelayMs * 2 ** attempt, env.dsp.reconnectMaxDelayMs));
      attempt += 1;
      continue;
    }

    logger.warn('DSP calibration request failed', { status: res.status, detail, attempt });
    throw ApiError.internal('Calibration service is unavailable — please try again.');
  }
}

module.exports = { checkHealth, requestCalibration };
