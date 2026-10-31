// Challenge 3D: event-driven flow over RabbitMQ (transactional outbox -> durable queue -> deduping consumer).
//   (a) duplicate delivery: the same message (same messageId) delivered again is processed only once
//   (b) consumer down: orders still succeed, events wait in the durable queue, and the restarted
//       notification-service catches up on the backlog
// Requires RabbitMQ and services started with "npm run start:all" (the script stops/starts notification-service).
// Usage: node scripts/challenge3d-events.js
const amqp = require('amqplib');
const svc = require('./svc');
const { URLS, DB_URLS, RABBITMQ_URL, api, query, runId, sleep, waitFor, createEvidence, grepServiceLog } = require('./lib/common');

const RUN = runId();
const EXCHANGE = process.env.EVENTS_EXCHANGE || 'skinsync.events';
const QUEUE = process.env.NOTIFICATION_QUEUE || 'notification.order-confirmed';
const ev = createEvidence('challenge-3d-events', 'run');

async function placeOrder(userId) {
  const cart = await api('POST', `${URLS.order}/api/v1/carts/${userId}/items`, { body: { productId: 'p-016', quantity: 1 } });
  if (cart.status !== 201) throw new Error(`cart setup failed: ${cart.status}`);
  return api('POST', `${URLS.order}/api/v1/orders`, {
    body: { userId },
    headers: { 'Idempotency-Key': `${userId}-key`, 'X-Correlation-Id': `${userId}-order`, 'X-Payment-Simulate': 'success' },
  });
}

const notificationsFor = async (orderId) => (await api('GET', `${URLS.notification}/api/v1/notifications?orderId=${orderId}`)).body.items;

async function queueDepth() {
  const conn = await amqp.connect(RABBITMQ_URL);
  try {
    const ch = await conn.createChannel();
    return (await ch.checkQueue(QUEUE)).messageCount;
  } finally {
    await conn.close();
  }
}

async function preconditions() {
  ev.section('Preconditions');
  try {
    const conn = await amqp.connect(RABBITMQ_URL);
    await conn.close();
    ev.log(`RabbitMQ reachable at ${RABBITMQ_URL.replace(/\/\/.*@/, '//***@')}`);
  } catch (err) {
    throw new Error(`RabbitMQ is not reachable (${err.message}). Start RabbitMQ and retry.`);
  }
  for (const [name, url] of [['order-service', URLS.order], ['notification-service', URLS.notification]]) {
    // Services retry the broker every BROKER_RECONNECT_MS, so give them a moment after RabbitMQ starts.
    const h = await waitFor(async () => {
      const r = await api('GET', `${url}/health`).catch(() => null);
      return r && r.body.checks.broker === 'UP' ? r.body : null;
    }, { timeoutMs: 20000 });
    if (!h) throw new Error(`${name} is not connected to the broker (GET ${url}/health)`);
    ev.log(`${name} health:`, h);
  }
}

async function duplicateDelivery() {
  ev.section('(a) Duplicate delivery of the same message is processed once');
  const userId = `c3-${RUN}-dup`;
  const order = await placeOrder(userId);
  ev.log('Order placed:', order.status, order.body.id, order.body.status);
  const orderId = order.body.id;
  const first = await waitFor(async () => (await notificationsFor(orderId)).length > 0, { timeoutMs: 15000 });
  ev.check(Boolean(first), 'notification created for the order (first delivery)');

  const [outbox] = await query(DB_URLS.order, 'SELECT id, event_type, payload, correlation_id, published_at FROM outbox WHERE aggregate_id = $1', [orderId]);
  ev.log('order_db.outbox row (its id is the AMQP messageId):');
  ev.table([{ id: outbox.id, event_type: outbox.event_type, published_at: outbox.published_at }]);

  ev.log('Re-delivering the SAME message twice straight to the exchange (as a broker redelivery would)...');
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch = await conn.createConfirmChannel();
  for (let i = 1; i <= 2; i++) {
    ch.publish(EXCHANGE, outbox.event_type, Buffer.from(JSON.stringify(outbox.payload)), {
      persistent: true,
      messageId: outbox.id,
      contentType: 'application/json',
      headers: { 'x-correlation-id': `${userId}-redelivery-${i}` },
    });
  }
  await ch.waitForConfirms();
  await conn.close();

  ev.log('Simulating a relay crash after publish but before marking the row as sent: UPDATE outbox SET published_at = NULL ...');
  await query(DB_URLS.order, 'UPDATE outbox SET published_at = NULL WHERE id = $1', [outbox.id]);
  const republished = await waitFor(async () => (await query(DB_URLS.order, 'SELECT published_at FROM outbox WHERE id = $1', [outbox.id]))[0].published_at, { timeoutMs: 10000 });
  ev.log(`Relay published the row again at ${republished && republished.toISOString()}`);
  await sleep(2000);

  const notifications = await notificationsFor(orderId);
  const processed = await query(DB_URLS.notification, 'SELECT message_id, event_type, processed_at FROM processed_messages WHERE message_id = $1', [outbox.id]);
  ev.log('notification_db.notifications for the order:');
  ev.table(notifications.map((n) => ({ id: n.id, messageId: n.messageId, orderId: n.orderId, recipient: n.recipient, createdAt: n.createdAt })));
  ev.log('notification_db.processed_messages:');
  ev.table(processed);
  const dupLogs = grepServiceLog('notification-service', [outbox.id]).filter((l) => l.includes('duplicate message ignored') || !l.startsWith('{'));
  ev.log('notification-service log lines for this messageId (duplicates):');
  dupLogs.forEach((l) => ev.log(l));

  ev.check(notifications.length === 1, `exactly one notification after 4 deliveries (got ${notifications.length})`);
  ev.check(processed.length === 1, 'exactly one processed_messages row for the messageId');
  ev.check(dupLogs.filter((l) => l.includes('duplicate message ignored')).length >= 3, 'consumer logged the 3 extra deliveries as duplicates');
}

async function consumerCatchUp() {
  ev.section('(b) notification-service down: orders still succeed, backlog is consumed after restart');
  ev.log('Stopping notification-service...');
  await svc.stop('notification-service');
  if (await svc.health('notification-service')) {
    throw new Error('notification-service is still answering. Start services with "npm run start:all" so this script can stop it.');
  }
  const depthBefore = await queueDepth();

  const orders = [];
  for (let i = 1; i <= 3; i++) {
    const res = await placeOrder(`c3-${RUN}-down-${i}`);
    orders.push(res.body);
    ev.log(`Order ${i} while consumer is down:`, res.status, res.body.id, res.body.status);
  }
  ev.check(orders.every((o) => o.status === 'CONFIRMED'), 'all 3 orders CONFIRMED while notification-service was down');

  await waitFor(async () => (await api('GET', `${URLS.order}/health`)).body.checks.outboxPending === 0, { timeoutMs: 10000 });
  const depth = await queueDepth();
  ev.log(`Queue ${QUEUE} depth: before=${depthBefore}, after placing orders=${depth}`);
  ev.check(depth >= depthBefore + 3, `events are waiting in the durable queue (depth ${depth})`);

  ev.log('Starting notification-service again...');
  await svc.start('notification-service');
  const caughtUp = await waitFor(async () => {
    for (const o of orders) if ((await notificationsFor(o.id)).length !== 1) return false;
    return true;
  }, { timeoutMs: 30000 });
  ev.check(Boolean(caughtUp), 'after restart, a notification exists for every order placed while it was down');
  const rows = [];
  for (const o of orders) {
    const [n] = await notificationsFor(o.id);
    rows.push({ orderId: o.id, orderConfirmedAt: o.updatedAt, notifiedAt: n?.createdAt || 'MISSING', recipient: n?.recipient });
  }
  ev.table(rows);
  const depthAfter = await queueDepth();
  ev.log(`Queue depth after catch-up: ${depthAfter}`);
  ev.check(depthAfter === 0, 'queue drained');
}

async function main() {
  await preconditions();
  await duplicateDelivery();
  await consumerCatchUp();
  process.exit(ev.finish() ? 0 : 1);
}

main().catch((err) => {
  ev.log(`ERROR: ${err.message}`);
  ev.finish();
  process.exit(1);
});
