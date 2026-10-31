// Data access for notification-service. Only this module contains SQL.
const { pool } = require('./db');

function toNotification(row) {
  return {
    id: row.id,
    messageId: row.message_id,
    orderId: row.order_id,
    userId: row.user_id,
    channel: row.channel,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
  };
}

// Returns false if this messageId was already processed (duplicate delivery).
async function markProcessed(client, messageId, eventType) {
  const { rowCount } = await client.query(
    'INSERT INTO processed_messages (message_id, event_type) VALUES ($1, $2) ON CONFLICT (message_id) DO NOTHING',
    [messageId, eventType],
  );
  return rowCount === 1;
}

async function insertNotification(client, n) {
  const { rows } = await client.query(
    `INSERT INTO notifications (message_id, order_id, user_id, channel, recipient, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'SENT') RETURNING *`,
    [n.messageId, n.orderId, n.userId, n.channel, n.recipient, n.subject, n.body],
  );
  return toNotification(rows[0]);
}

async function listNotifications({ userId, orderId, limit }) {
  const where = [];
  const params = [];
  if (userId) {
    params.push(userId);
    where.push(`user_id = $${params.length}`);
  }
  if (orderId) {
    params.push(orderId);
    where.push(`order_id = $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM notifications ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toNotification);
}

async function findNotification(id) {
  const { rows } = await pool.query('SELECT * FROM notifications WHERE id = $1', [id]);
  return rows[0] ? toNotification(rows[0]) : null;
}

module.exports = { markProcessed, insertNotification, listNotifications, findNotification };
