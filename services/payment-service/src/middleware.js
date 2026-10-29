const { randomUUID } = require('node:crypto');
const log = require('./logger');
const { AppError } = require('./errors');

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,100}$/;

function correlationId(req, res, next) {
  const incoming = req.get('X-Correlation-Id');
  const id = incoming && SAFE_CORRELATION_ID.test(incoming) ? incoming : randomUUID();
  req.correlationId = id;
  res.set('X-Correlation-Id', id);
  log.requestContext.run({ correlationId: id }, next);
}

function requestLogger(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    log.info('http request', {
      correlationId: req.correlationId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - started,
    });
  });
  next();
}

function sendError(req, res, status, code, message, details = null) {
  res.status(status).json({ error: { code, message, details, correlationId: req.correlationId } });
}

function notFound(req, res) {
  sendError(req, res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return sendError(req, res, err.status, err.code, err.message, err.details);
  }
  if (err.type === 'entity.parse.failed') {
    return sendError(req, res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  log.error('unhandled error', { error: err.message, stack: err.stack });
  return sendError(req, res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

module.exports = { correlationId, requestLogger, notFound, errorHandler };
