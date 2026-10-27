// Data access for order-service. Only this module contains SQL.
const { pool } = require('./db');

// ---- Cart ----
async function getCartItems(userId) {
  const { rows } = await pool.query(
    'SELECT product_id, quantity, added_at FROM cart_items WHERE user_id = $1 ORDER BY added_at, product_id',
    [userId],
  );
  return rows.map((r) => ({ productId: r.product_id, quantity: r.quantity, addedAt: r.added_at }));
}

async function getCartQuantity(userId, productId) {
  const { rows } = await pool.query('SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2', [userId, productId]);
  return rows[0] ? rows[0].quantity : 0;
}

async function saveCartItem(userId, productId, quantity) {
  await pool.query(
    `INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [userId, productId, quantity],
  );
}

async function updateCartItem(userId, productId, quantity) {
  const { rowCount } = await pool.query(
    'UPDATE cart_items SET quantity = $3, updated_at = now() WHERE user_id = $1 AND product_id = $2',
    [userId, productId, quantity],
  );
  return rowCount === 1;
}

async function deleteCartItem(userId, productId) {
  const { rowCount } = await pool.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [userId, productId]);
  return rowCount === 1;
}

async function removeCartItems(client, userId, productIds) {
  await client.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = ANY($2)', [userId, productIds]);
}

// ---- Orders ----
async function insertOrder(client, { id, userId, items, idempotencyKey }) {
  await client.query(`INSERT INTO orders (id, user_id, status) VALUES ($1, $2, 'PENDING')`, [id, userId]);
  for (const item of items) {
    await client.query('INSERT INTO order_items (order_id, product_id, quantity) VALUES ($1, $2, $3)', [id, item.productId, item.quantity]);
  }
  await client.query(`INSERT INTO order_status_history (order_id, from_status, to_status) VALUES ($1, NULL, 'PENDING')`, [id]);
  await client.query('UPDATE idempotency_keys SET order_id = $2, updated_at = now() WHERE key = $1', [idempotencyKey, id]);
}

// Compare-and-set: only succeeds if the order is still in the expected status.
async function updateStatus(client, orderId, from, to, { paymentId = null, failureReason = null } = {}) {
  const { rowCount } = await client.query(
    `UPDATE orders SET status = $3, payment_id = COALESCE($4, payment_id),
       failure_reason = COALESCE($5, failure_reason), updated_at = now()
     WHERE id = $1 AND status = $2`,
    [orderId, from, to, paymentId, failureReason],
  );
  return rowCount === 1;
}

async function insertStatusHistory(client, orderId, from, to, reason) {
  await client.query(
    'INSERT INTO order_status_history (order_id, from_status, to_status, reason) VALUES ($1, $2, $3, $4)',
    [orderId, from, to, reason],
  );
}

async function setItemPrices(client, orderId, items, totalCents) {
  for (const item of items) {
    await client.query(
      'UPDATE order_items SET product_name = $3, unit_price_cents = $4 WHERE order_id = $1 AND product_id = $2',
      [orderId, item.productId, item.name, item.unitPriceCents],
    );
  }
  await client.query('UPDATE orders SET total_cents = $2 WHERE id = $1', [orderId, totalCents]);
}

function toOrder(row, items, history) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    totalCents: row.total_cents,
    paymentId: row.payment_id,
    failureReason: row.failure_reason,
    items: items.map((i) => ({
      productId: i.product_id,
      productName: i.product_name,
      unitPriceCents: i.unit_price_cents,
      quantity: i.quantity,
    })),
    history: history.map((h) => ({ from: h.from_status, to: h.to_status, reason: h.reason, at: h.changed_at })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findOrder(orderId) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (!rows[0]) return null;
  const items = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY product_id', [orderId]);
  const history = await pool.query('SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY id', [orderId]);
  return toOrder(rows[0], items.rows, history.rows);
}

async function listOrders(userId) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    status: r.status,
    totalCents: r.total_cents,
    failureReason: r.failure_reason,
    createdAt: r.created_at,
  }));
}

// ---- Idempotency keys ----
// Returns true if this request now owns the key. Of two simultaneous inserts, PostgreSQL makes the
// second wait on the primary key and then do nothing, so exactly one request executes the order.
async function claimIdempotencyKey(key, requestHash) {
  const { rowCount } = await pool.query(
    `INSERT INTO idempotency_keys (key, request_hash, status) VALUES ($1, $2, 'IN_PROGRESS') ON CONFLICT (key) DO NOTHING`,
    [key, requestHash],
  );
  return rowCount === 1;
}

async function findIdempotencyKey(key) {
  const { rows } = await pool.query('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
  if (!rows[0]) return null;
  return {
    key: rows[0].key,
    requestHash: rows[0].request_hash,
    status: rows[0].status,
    orderId: rows[0].order_id,
    responseStatus: rows[0].response_status,
    responseBody: rows[0].response_body === null ? null : JSON.parse(rows[0].response_body),
  };
}

async function completeIdempotencyKey(key, responseStatus, responseBody) {
  await pool.query(
    `UPDATE idempotency_keys SET status = 'COMPLETED', response_status = $2, response_body = $3, updated_at = now() WHERE key = $1`,
    [key, responseStatus, JSON.stringify(responseBody)],
  );
}

// ---- Outbox ----
async function insertOutboxEvent(client, { id, aggregateId, eventType, payload, correlationId }) {
  await client.query(
    'INSERT INTO outbox (id, aggregate_id, event_type, payload, correlation_id) VALUES ($1, $2, $3, $4, $5)',
    [id, aggregateId, eventType, JSON.stringify(payload), correlationId],
  );
}

// SKIP LOCKED lets several relay instances (e.g. replicas) run without publishing the same row at once.
async function lockUnpublishedEvents(client, limit) {
  const { rows } = await client.query(
    `SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    payload: r.payload,
    correlationId: r.correlation_id,
  }));
}

async function markPublished(client, id) {
  await client.query('UPDATE outbox SET published_at = now() WHERE id = $1', [id]);
}

async function countUnpublishedEvents() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL');
  return rows[0].n;
}

module.exports = {
  getCartItems,
  getCartQuantity,
  saveCartItem,
  updateCartItem,
  deleteCartItem,
  removeCartItems,
  insertOrder,
  updateStatus,
  insertStatusHistory,
  setItemPrices,
  findOrder,
  listOrders,
  claimIdempotencyKey,
  findIdempotencyKey,
  completeIdempotencyKey,
  insertOutboxEvent,
  lockUnpublishedEvents,
  markPublished,
  countUnpublishedEvents,
};
