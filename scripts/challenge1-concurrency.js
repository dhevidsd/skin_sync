// Challenge 1: concurrency control on the contended resource (product stock).
//   Part A: N units of stock, R parallel orders through order-service -> exactly N succeed, R-N get 409 OUT_OF_STOCK.
//   Part B: the same race against a naive check-then-update endpoint -> it oversells.
// Usage: node scripts/challenge1-concurrency.js [--stock 5] [--requests 25]
const { URLS, DB_URLS, api, query, runId, createEvidence } = require('./lib/common');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const STOCK = arg('stock', 5);
const REQUESTS = arg('requests', 25);
const RUN = runId();
const ev = createEvidence('challenge-1-concurrency', 'run');

async function resetProduct(id, name) {
  const res = await api('PUT', `${URLS.catalog}/api/v1/products/${id}`, {
    body: { name, brand: 'SkinSync Labs', category: 'serum', priceCents: 2500, skinTypes: ['all'], stock: STOCK, description: 'Challenge 1 test product' },
  });
  if (res.status > 201) throw new Error(`could not reset ${id}: ${res.status}`);
}

async function partA() {
  ev.section(`Part A: atomic reservation, stock = ${STOCK}, ${REQUESTS} parallel orders`);
  const productId = 'p-c1-atomic';
  await resetProduct(productId, 'Challenge 1 Limited Serum');
  const users = Array.from({ length: REQUESTS }, (_, i) => `c1-${RUN}-u${String(i + 1).padStart(2, '0')}`);
  for (const userId of users) {
    const res = await api('POST', `${URLS.order}/api/v1/carts/${userId}/items`, { body: { productId, quantity: 1 } });
    if (res.status !== 201) throw new Error(`cart setup failed for ${userId}: ${res.status}`);
  }
  ev.log(`Setup: product ${productId} stock=${STOCK}; ${REQUESTS} users each have 1 unit in their cart.`);
  ev.log(`Firing ${REQUESTS} POST /api/v1/orders at the same time (Promise.all)...`);

  const started = Date.now();
  const results = await Promise.all(
    users.map((userId, i) =>
      api('POST', `${URLS.order}/api/v1/orders`, {
        body: { userId },
        headers: {
          'Idempotency-Key': `c1-${RUN}-key-${i + 1}`,
          'X-Correlation-Id': `c1-${RUN}-req-${i + 1}`,
          'X-Payment-Simulate': 'success',
        },
      }).then((r) => ({ userId, ...r })),
    ),
  );
  ev.log(`All ${REQUESTS} responses received in ${Date.now() - started} ms`);
  ev.table(results.map((r) => ({ user: r.userId, http: r.status, result: r.status === 201 ? r.body.status : r.body.error.code, ms: r.ms })));

  const ok = results.filter((r) => r.status === 201);
  const outOfStock = results.filter((r) => r.status === 409 && r.body.error.code === 'OUT_OF_STOCK');
  ev.log(`\nSucceeded: ${ok.length}   Rejected with 409 OUT_OF_STOCK: ${outOfStock.length}   Other: ${REQUESTS - ok.length - outOfStock.length}`);
  ev.log('Sample rejection body:', outOfStock[0]?.body);

  ev.section('Final database state');
  const [product] = await query(DB_URLS.catalog, 'SELECT id, stock, updated_at FROM products WHERE id = $1', [productId]);
  ev.log('catalog_db.products:');
  ev.table([product]);
  const orderIds = results.map((r) => r.body?.id || r.body?.error?.details?.orderId).filter(Boolean);
  const reserved = await query(
    DB_URLS.catalog,
    `SELECT r.status, count(*)::int AS reservations, coalesce(sum(ri.quantity), 0)::int AS units
     FROM reservations r JOIN reservation_items ri ON ri.order_id = r.order_id
     WHERE ri.product_id = $1 AND r.order_id = ANY($2) GROUP BY r.status`,
    [productId, orderIds],
  );
  ev.log('catalog_db.reservations for this run:');
  ev.table(reserved);
  const orders = await query(
    DB_URLS.order,
    `SELECT status, failure_reason, count(*)::int AS orders FROM orders WHERE user_id LIKE $1 GROUP BY status, failure_reason ORDER BY status`,
    [`c1-${RUN}-%`],
  );
  ev.log('order_db.orders for this run:');
  ev.table(orders);

  const unitsReserved = reserved.filter((r) => r.status === 'RESERVED').reduce((n, r) => n + r.units, 0);
  const confirmed = orders.find((o) => o.status === 'CONFIRMED')?.orders || 0;
  ev.log('');
  ev.check(ok.length === STOCK, `exactly ${STOCK} orders succeeded (got ${ok.length})`);
  ev.check(outOfStock.length === REQUESTS - STOCK, `the other ${REQUESTS - STOCK} were rejected with 409 OUT_OF_STOCK (got ${outOfStock.length})`);
  ev.check(product.stock === 0, `stock is exactly 0, never negative (got ${product.stock})`);
  ev.check(unitsReserved === STOCK, `reserved units in catalog_db = ${STOCK} (got ${unitsReserved})`);
  ev.check(confirmed === STOCK, `CONFIRMED orders in order_db = ${STOCK} (got ${confirmed})`);
}

async function partB() {
  ev.section(`Part B: naive check-then-update (counter-example), stock = ${STOCK}, ${REQUESTS} parallel requests`);
  const productId = 'p-c1-naive';
  await resetProduct(productId, 'Challenge 1 Naive Demo Serum');
  const probe = await api('POST', `${URLS.catalog}/api/v1/demo/naive-reservations`, { body: {} });
  if (probe.status === 404) {
    ev.log('SKIPPED: naive endpoint disabled. Set ENABLE_NAIVE_DEMO=true in services/catalog-service/.env and restart catalog-service.');
    return;
  }
  const results = await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) =>
      api('POST', `${URLS.catalog}/api/v1/demo/naive-reservations`, {
        body: { productId, quantity: 1 },
        headers: { 'X-Correlation-Id': `c1-${RUN}-naive-${i + 1}` },
      }),
    ),
  );
  const ok = results.filter((r) => r.status === 200);
  ev.table(ok.slice(0, 10).map((r) => ({ http: r.status, stockRead: r.body.stockRead, stockWritten: r.body.stockWritten })));
  if (ok.length > 10) ev.log(`... ${ok.length - 10} more successful responses`);
  const [product] = await query(DB_URLS.catalog, 'SELECT id, stock FROM products WHERE id = $1', [productId]);
  ev.log(`Naive endpoint accepted ${ok.length} reservations for ${STOCK} units. Final stock in DB: ${product.stock}.`);
  ev.log(`Units handed out: ${ok.length}; units actually removed from stock: ${STOCK - product.stock}; oversold by ${ok.length - STOCK}.`);
  ev.check(ok.length > STOCK, `naive check-then-update oversells (${ok.length} accepted > ${STOCK} available): this is the bug the atomic UPDATE prevents`);
}

function explain() {
  ev.section('Why a plain check-then-update fails');
  ev.log(`Naive: SELECT stock -> if stock >= qty (in Node.js) -> UPDATE products SET stock = <value computed in Node.js>.
Two requests can both read stock = 1 before either writes. Both pass the check and both write 0,
so two units are sold while only one existed (lost update). With more parallel requests it gets worse.

SkinSync instead runs, inside a transaction:
  UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty RETURNING ...
The condition and the write are one atomic statement. PostgreSQL takes a row lock, so a concurrent
UPDATE waits, then re-evaluates "stock >= $qty" against the committed value. When stock runs out the
UPDATE matches 0 rows and the service answers 409 OUT_OF_STOCK. A CHECK (stock >= 0) constraint is the
last line of defence. Multi-item orders lock rows in productId order to avoid deadlocks.`);
}

async function main() {
  for (const [name, url] of Object.entries({ catalog: URLS.catalog, order: URLS.order, payment: URLS.payment })) {
    const h = await api('GET', `${url}/health`).catch(() => null);
    if (!h || h.status !== 200) throw new Error(`${name} service is not healthy at ${url}`);
  }
  await partA();
  await partB();
  explain();
  process.exit(ev.finish() ? 0 : 1);
}

main().catch((err) => {
  ev.log(`ERROR: ${err.message}`);
  process.exit(1);
});
