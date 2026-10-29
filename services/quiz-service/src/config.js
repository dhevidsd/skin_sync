require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

module.exports = {
  serviceName: 'quiz-service',
  port: Number(required('PORT')),
  databaseUrl: required('DATABASE_URL'),
  catalogServiceUrl: required('CATALOG_SERVICE_URL'),
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 2000),
  logLevel: process.env.LOG_LEVEL || 'info',
};
