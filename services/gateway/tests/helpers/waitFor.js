/**
 * Polls `fn` until it resolves without throwing, or `timeoutMs` elapses (in
 * which case the last error is re-thrown). Needed for the session-completion
 * pipeline (`sessionService.endSession`), which kicks off analysis-result +
 * report + notification generation as fire-and-forget work rather than
 * awaiting it before responding — see that function's comment.
 */
async function waitFor(fn, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  let lastError;

  while (Date.now() - start < timeoutMs) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError;
}

module.exports = { waitFor };
