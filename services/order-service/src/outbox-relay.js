// Transactional outbox relay (Challenge 3D). Events are written to the outbox table in the same
// DB transaction as the order change; this loop publishes them and marks them as sent.
// Delivery is at-least-once: if the process stops after publishing but before marking a row,
// the event is published again and the consumer's dedupe (processed_messages) drops it.
const config = require('./config');
const log = require('./logger');
const messaging = require('./messaging');
const repo = require('./repository');
const { withTransaction } = require('./db');

let timer = null;
let stopped = false;

async function relayOnce() {
  if (!messaging.isConnected()) return 0;
  return withTransaction(async (client) => {
    const events = await repo.lockUnpublishedEvents(client, 50);
    for (const event of events) {
      await log.requestContext.run({ correlationId: event.correlationId }, async () => {
        await messaging.publish(event.eventType, event.payload, { messageId: event.id, correlationId: event.correlationId });
        await repo.markPublished(client, event.id);
        log.info('outbox event published', { messageId: event.id, eventType: event.eventType, orderId: event.payload.data.orderId });
      });
    }
    return events.length;
  });
}

async function loop() {
  try {
    await relayOnce();
  } catch (err) {
    log.warn('outbox relay failed, will retry', { error: err.message });
  }
  if (!stopped) timer = setTimeout(loop, config.outboxPollIntervalMs);
}

function start() {
  loop();
}

function stop() {
  stopped = true;
  clearTimeout(timer);
}

module.exports = { start, stop, relayOnce };
