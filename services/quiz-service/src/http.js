const log = require('./logger');
const { AppError } = require('./errors');

// Calls another service and forwards the correlation id. Timeouts and network errors become
// 503 DEPENDENCY_UNAVAILABLE; HTTP error responses are returned for the caller to interpret.
async function callService(dependency, baseUrl, path, { method = 'GET', body, headers = {}, timeoutMs }) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
  const correlationId = log.requestContext.getStore()?.correlationId;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(correlationId && { 'X-Correlation-Id': correlationId }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    log.info('downstream call', { dependency, method, url, status: res.status, durationMs: Date.now() - started });
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timeout after ${timeoutMs}ms` : err.cause?.code || err.message;
    log.warn('downstream call failed', { dependency, method, url, reason, durationMs: Date.now() - started });
    throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', `${dependency} is unavailable`, { dependency, reason });
  }
}

module.exports = { callService };
