// RabbitMQ consumer. The HTTP API keeps working while the broker is down; the consumer
// reconnects in the background and then receives the backlog kept in the durable queue.
const amqp = require('amqplib');
const config = require('./config');
const log = require('./logger');
const service = require('./service');
const { AppError } = require('./errors');

let connection = null;
let channel = null;
let stopped = false;

function scheduleReconnect() {
  if (!stopped) setTimeout(connect, config.brokerReconnectMs).unref();
}

async function onMessage(ch, msg) {
  const messageId = msg.properties.messageId;
  const correlationId = msg.properties.headers?.['x-correlation-id'];
  await log.requestContext.run({ correlationId }, async () => {
    log.info('message received', { messageId, redelivered: msg.fields.redelivered });
    try {
      await service.handleOrderConfirmed(messageId, JSON.parse(msg.content.toString()));
      ch.ack(msg); // manual ack only after the DB transaction committed
    } catch (err) {
      if (err instanceof AppError || err instanceof SyntaxError) {
        // Malformed message: retrying cannot help, so drop it (a dead-letter queue is future work).
        log.error('invalid message dropped', { messageId, error: err.message });
        ch.ack(msg);
      } else {
        log.error('message processing failed, requeueing', { messageId, error: err.message });
        setTimeout(() => {
          try {
            ch.nack(msg, false, true);
          } catch {
            // channel already closed: the broker redelivers unacked messages anyway
          }
        }, 1000);
      }
    }
  });
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
    const ch = await conn.createChannel();
    await ch.assertExchange(config.eventsExchange, 'topic', { durable: true });
    await ch.assertQueue(config.notificationQueue, { durable: true });
    await ch.bindQueue(config.notificationQueue, config.eventsExchange, 'order.confirmed');
    await ch.prefetch(config.prefetch);
    await ch.consume(config.notificationQueue, (msg) => msg && onMessage(ch, msg), { noAck: false });
    connection = conn;
    channel = ch;
    log.info('consuming from broker', { queue: config.notificationQueue });
  } catch (err) {
    log.warn('broker unavailable, will retry', { error: err.message, retryInMs: config.brokerReconnectMs });
    scheduleReconnect();
  }
}

function isConnected() {
  return channel !== null;
}

async function close() {
  stopped = true;
  if (connection) await connection.close().catch(() => {});
}

module.exports = { connect, isConnected, close };
