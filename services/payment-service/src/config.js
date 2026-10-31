require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

module.exports = {
  serviceName: 'payment-service',
  port: Number(required('PORT')),
  databaseUrl: required('DATABASE_URL'),
  logLevel: process.env.LOG_LEVEL || 'info',
  latencyMs: Number(process.env.PAYMENT_LATENCY_MS || 200),
  failureRate: Number(process.env.PAYMENT_FAILURE_RATE || 0),
  allowSimulationHeader: process.env.ALLOW_SIMULATION_HEADER === 'true',
};
