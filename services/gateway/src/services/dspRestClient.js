const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

function authHeaders() {
  return env.dsp.serviceToken ? { Authorization: `Bearer ${env.dsp.serviceToken}` } : {};
}

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
  const res = await fetch(`${env.dsp.restUrl}/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ userId, referenceStats, demoMode: Boolean(demoMode) }),
    signal: AbortSignal.timeout(env.dsp.calibrationTimeoutMs),
  });

  if (!res.ok) {
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

    logger.warn('DSP calibration request failed', { status: res.status, detail });
    throw ApiError.internal('Calibration service is unavailable — please try again.');
  }

  return res.json();
}

module.exports = { checkHealth, requestCalibration };
