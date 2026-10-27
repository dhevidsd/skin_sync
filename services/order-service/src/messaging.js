// RabbitMQ publisher. The service keeps serving HTTP while the broker is down and reconnects
// in the background; unpublished events simply wait in the outbox table.
const amqp = require('amqplib');
const config = require('./config');
const log = require('./logger');

let connection = null;
let channel = null;
let stopped = false;

function scheduleReconnect() {
  if (!stopped) setTimeout(connect, config.brokerReconnectMs).unref();
}

async function connect() {
  try {
    const conn = await amqp.connect(config.rabbitmqUrl);
    conn.on('error', (err) => log.warn('broker connection error', { error: err.message }));
    conn.on('close', () => {
      connection = null;
      channel = null;
      if (!stopped) log.warn('broker connection closed, reconnecting', { retryInMs: config.brokerReconnectMs });
      scheduleReconnect();
    });
    // Confirm channel: the broker acknowledges each publish once it has safely stored the message.
    const ch = await conn.createConfirmChannel();
    await ch.assertExchange(config.eventsExchange, 'topic', { durable: true });
    // Declared here too so events are kept even if notification-service has never started.
    await ch.assertQueue(config.notificationQueue, { durable: true });
    await ch.bindQueue(config.notificationQueue, config.eventsExchange, 'order.confirmed');
    connection = conn;
    channel = ch;
    log.info('connected to broker', { exchange: config.eventsExchange });
  } catch (err) {
    log.warn('broker unavailable, will retry', { error: err.message, retryInMs: config.brokerReconnectMs });
    scheduleReconnect();
  }
}

function isConnected() {
  return channel !== null;
}

async function publish(routingKey, payload, { messageId, correlationId }) {
  if (!channel) throw new Error('broker not connected');
  channel.publish(config.eventsExchange, routingKey, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    messageId,
    contentType: 'application/json',
    type: routingKey,
    timestamp: Math.floor(Date.now() / 1000),
    headers: { 'x-correlation-id': correlationId },
  });
  await channel.waitForConfirms();
}

async function close() {
  stopped = true;
  if (connection) await connection.close().catch(() => {});
}

module.exports = { connect, isConnected, publish, close };
