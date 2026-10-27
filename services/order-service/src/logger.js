const { AsyncLocalStorage } = require('node:async_hooks');
const config = require('./config');

// Holds { correlationId } for the current request/message so every log line and outgoing call can use it.
const requestContext = new AsyncLocalStorage();

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[config.logLevel] || LEVELS.info;

function write(level, msg, fields = {}) {
  if (LEVELS[level] < minLevel) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    service: config.serviceName,
    correlationId: requestContext.getStore()?.correlationId,
    msg,
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

module.exports = {
  requestContext,
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
