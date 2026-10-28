require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

module.exports = {
  serviceName: 'catalog-service',
  port: Number(required('PORT')),
  databaseUrl: required('DATABASE_URL'),
  logLevel: process.env.LOG_LEVEL || 'info',
  enableNaiveDemo: process.env.ENABLE_NAIVE_DEMO === 'true',
  naiveDemoDelayMs: Number(process.env.NAIVE_DEMO_DELAY_MS || 50),
};
