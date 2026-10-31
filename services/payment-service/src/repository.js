// Data access for payment-service. Only this module contains SQL.
const { pool } = require('./db');

function toPayment(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    amountCents: row.amount_cents,
    status: row.status,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

async function findByOrderId(orderId) {
  const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [orderId]);
  return rows[0] ? toPayment(rows[0]) : null;
}

async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
  return rows[0] ? toPayment(rows[0]) : null;
}

// The UNIQUE(order_id) constraint decides the winner when duplicates arrive at the same time.
// Returns null if another request already recorded a payment for this order.
async function insertIfAbsent(p) {
  const { rows } = await pool.query(
    `INSERT INTO payments (order_id, user_id, amount_cents, status, failure_reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [p.orderId, p.userId, p.amountCents, p.status, p.failureReason],
  );
  return rows[0] ? toPayment(rows[0]) : null;
}

module.exports = { findByOrderId, findById, insertIfAbsent };
