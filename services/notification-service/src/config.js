require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

module.exports = {
  serviceName: 'notification-service',
  port: Number(required('PORT')),
  databaseUrl: required('DATABASE_URL'),
  rabbitmqUrl: required('RABBITMQ_URL'),
  logLevel: process.env.LOG_LEVEL || 'info',
  eventsExchange: process.env.EVENTS_EXCHANGE || 'skinsync.events',
  notificationQueue: process.env.NOTIFICATION_QUEUE || 'notification.order-confirmed',
  prefetch: Number(process.env.CONSUMER_PREFETCH || 10),
  brokerReconnectMs: Number(process.env.BROKER_RECONNECT_MS || 5000),
  emailLatencyMs: Number(process.env.EMAIL_LATENCY_MS || 100),
};
