require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

module.exports = {
  serviceName: 'order-service',
  port: Number(required('PORT')),
  databaseUrl: required('DATABASE_URL'),
  catalogServiceUrl: required('CATALOG_SERVICE_URL'),
  paymentServiceUrl: required('PAYMENT_SERVICE_URL'),
  rabbitmqUrl: required('RABBITMQ_URL'),
  logLevel: process.env.LOG_LEVEL || 'info',
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 2000),
  paymentTimeoutMs: Number(process.env.PAYMENT_TIMEOUT_MS || 3000),
  paymentMaxAttempts: Number(process.env.PAYMENT_MAX_ATTEMPTS || 3),
  paymentRetryBaseMs: Number(process.env.PAYMENT_RETRY_BASE_MS || 200),
  idempotencyWaitMs: Number(process.env.IDEMPOTENCY_WAIT_MS || 5000),
  eventsExchange: process.env.EVENTS_EXCHANGE || 'skinsync.events',
  notificationQueue: process.env.NOTIFICATION_QUEUE || 'notification.order-confirmed',
  outboxPollIntervalMs: Number(process.env.OUTBOX_POLL_INTERVAL_MS || 1000),
  brokerReconnectMs: Number(process.env.BROKER_RECONNECT_MS || 5000),
};
