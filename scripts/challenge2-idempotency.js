// Challenge 2: idempotent order placement (Idempotency-Key) and idempotent payment (per orderId).
//   1. sequential repeat -> same response, Idempotent-Replayed: true, no second order
//   2. same key + different payload -> 422 IDEMPOTENCY_KEY_REUSED
//   3. 10 identical requests at the same moment -> one execution, ten identical responses
//   4. payment-service called again for the same order -> original payment, no second charge
// Usage: node scripts/challenge2-idempotency.js
const { URLS, DB_URLS, api, query, runId, sleep, createEvidence, grepServiceLog } = require('./lib/common');

const RUN = runId();
const ev = createEvidence('challenge-2-idempotency', 'run');
const PRODUCT = 'p-001';

async function fillCart(userId, quantity) {
  const res = await api('POST', `${URLS.order}/api/v1/carts/${userId}/items`, { body: { productId: PRODUCT, quantity } });
  if (res.status !== 201) throw new Error(`cart setup failed: ${res.status} ${JSON.stringify(res.body)}`);
}

function placeOrder(userId, key, correlationId, extraHeaders = {}) {
  return api('POST', `${URLS.order}/api/v1/orders`, {
    body: { userId },
    headers: { 'Idempotency-Key': key, 'X-Correlation-Id': correlationId, 'X-Payment-Simulate': 'success', ...extraHeaders },
  });
}

const summary = (r) => ({
  http: r.status,
  replayed: r.headers.get('idempotent-replayed'),
  orderId: r.body?.id || r.body?.error?.details?.orderId || null,
  status: r.body?.status || r.body?.error?.code,
  ms: r.ms,
});

async function sequential() {
  ev.section('1. Sequential repeat with the same Idempotency-Key');
  const userId = `c2-${RUN}-seq`;
  const key = `c2-${RUN}-seq-key`;
  await fillCart(userId, 2);
  const first = await placeOrder(userId, key, `c2-${RUN}-seq-1`);
  const second = await placeOrder(userId, key, `c2-${RUN}-seq-2`);
  const third = await placeOrder(userId, key, `c2-${RUN}-seq-3`);
  ev.log('First call  :', summary(first));
  ev.log('Second call :', summary(second));
  ev.log('Third call  :', summary(third));
  ev.log('First response body:', first.body);
  ev.check(first.status === 201 && first.headers.get('idempotent-replayed') === 'false', 'first call executed the order (201, Idempotent-Replayed: false)');
  ev.check(second.status === 201 && second.headers.get('idempotent-replayed') === 'true', 'repeat returned 201 with Idempotent-Replayed: true');
  ev.check(JSON.stringify(second.body) === JSON.stringify(first.body) && JSON.stringify(third.body) === JSON.stringify(first.body), 'repeat bodies are byte-identical to the first response');
  return { userId, key, orderId: first.body.id };
}

async function differentPayload(key) {
  ev.section('2. Same Idempotency-Key, different payload');
  const res = await placeOrder(`c2-${RUN}-someone-else`, key, `c2-${RUN}-mismatch`);
  ev.log('Response:', res.status, res.body);
  ev.check(res.status === 422 && res.body.error.code === 'IDEMPOTENCY_KEY_REUSED', 'rejected with 422 IDEMPOTENCY_KEY_REUSED');
}

async function concurrent() {
  ev.section('3. Ten identical requests arriving at the same moment');
  const userId = `c2-${RUN}-par`;
  const key = `c2-${RUN}-par-key`;
  await fillCart(userId, 1);
  ev.log('Payment is delayed by 1000 ms (X-Payment-Simulate: delay=1000) so all 10 requests overlap the first one.');
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => placeOrder(userId, key, `c2-${RUN}-par-${i + 1}`, { 'X-Payment-Simulate': 'delay=1000,success' })),
  );
  ev.table(results.map((r, i) => ({ request: i + 1, ...summary(r) })));
  const orderIds = new Set(results.map((r) => r.body.id));
  const executed = results.filter((r) => r.headers.get('idempotent-replayed') === 'false');
  ev.check(results.every((r) => r.status === 201), 'all 10 requests got 201');
  ev.check(orderIds.size === 1, `all 10 responses reference the same order (${[...orderIds].join(', ')})`);
  ev.check(executed.length === 1, `exactly 1 request executed the order, ${results.length - executed.length} were replays`);
  return { userId, key, orderId: [...orderIds][0] };
}

async function paymentIdempotency(orderId, userId) {
  ev.section('4. payment-service is idempotent per orderId (BR6)');
  const [order] = await query(DB_URLS.order, 'SELECT total_cents, payment_id FROM orders WHERE id = $1', [orderId]);
  const again = await api('POST', `${URLS.payment}/api/v1/payments`, {
    body: { orderId, userId, amountCents: order.total_cents },
    headers: { 'X-Correlation-Id': `c2-${RUN}-pay-repeat` },
  });
  ev.log('Charge the same order again:', again.status, `Idempotent-Replayed: ${again.headers.get('idempotent-replayed')}`, again.body);
  ev.check(again.status === 200 && again.body.id === order.payment_id, 'second charge returns the ORIGINAL payment (200), nothing new charged');
  const tampered = await api('POST', `${URLS.payment}/api/v1/payments`, {
    body: { orderId, userId, amountCents: order.total_cents + 1 },
    headers: { 'X-Correlation-Id': `c2-${RUN}-pay-mismatch` },
  });
  ev.log('Same order, different amount:', tampered.status, tampered.body);
  ev.check(tampered.status === 422 && tampered.body.error.code === 'IDEMPOTENCY_MISMATCH', 'different amount for an already charged order is rejected with 422');
}

async function databaseState(runs) {
  ev.section('Database state');
  const users = runs.map((r) => r.userId);
  const orders = await query(DB_URLS.order, 'SELECT id, user_id, status, total_cents, payment_id FROM orders WHERE user_id = ANY($1) ORDER BY user_id', [users]);
  ev.log('order_db.orders for the two test users:');
  ev.table(orders);
  const keys = await query(
    DB_URLS.order,
    `SELECT key, status, response_status, order_id, left(request_hash, 16) || '...' AS request_hash_sha256 FROM idempotency_keys WHERE key = ANY($1) ORDER BY key`,
    [runs.map((r) => r.key)],
  );
  ev.log('order_db.idempotency_keys:');
  ev.table(keys);
  const payments = await query(DB_URLS.payment, 'SELECT id, order_id, amount_cents, status FROM payments WHERE order_id = ANY($1) ORDER BY order_id', [runs.map((r) => r.orderId)]);
  ev.log('payment_db.payments:');
  ev.table(payments);
  const reservations = await query(DB_URLS.catalog, 'SELECT order_id, status FROM reservations WHERE order_id = ANY($1) ORDER BY order_id', [runs.map((r) => r.orderId)]);
  ev.log('catalog_db.reservations:');
  ev.table(reservations);

  for (const r of runs) {
    ev.check(orders.filter((o) => o.user_id === r.userId).length === 1, `${r.userId}: exactly one order`);
    ev.check(payments.filter((p) => p.order_id === r.orderId).length === 1, `${r.userId}: exactly one payment`);
    ev.check(reservations.filter((p) => p.order_id === r.orderId).length === 1, `${r.userId}: exactly one stock reservation`);
  }
}

function logs() {
  ev.section('Service logs for this run (order-service, payment-service)');
  const lines = [
    ...grepServiceLog('order-service', [`c2-${RUN}`]).filter((l) => /idempotency key claimed|idempotent replay|IDEMPOTENCY|order created/.test(l) || !l.startsWith('{')),
    ...grepServiceLog('payment-service', [`c2-${RUN}`]).filter((l) => /duplicate|payment processed/.test(l) || !l.startsWith('{')),
  ];
  for (const l of lines) ev.log(l);
}

async function main() {
  for (const url of [URLS.catalog, URLS.order, URLS.payment]) {
    const h = await api('GET', `${url}/health`).catch(() => null);
    if (!h || h.status !== 200) throw new Error(`service not healthy at ${url}`);
  }
  const seq = await sequential();
  await differentPayload(seq.key);
  const par = await concurrent();
  await paymentIdempotency(seq.orderId, seq.userId);
  await databaseState([seq, par]);
  await sleep(200);
  logs();
  process.exit(ev.finish() ? 0 : 1);
}

main().catch((err) => {
  ev.log(`ERROR: ${err.message}`);
  process.exit(1);
});
