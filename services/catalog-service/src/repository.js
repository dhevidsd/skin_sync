// Data access for catalog-service. Only this module contains SQL.
const { pool } = require('./db');

function toProduct(row) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    description: row.description,
    priceCents: row.price_cents,
    skinTypes: row.skin_types,
    stock: row.stock,
    updatedAt: row.updated_at,
  };
}

async function listProducts({ skinType, inStock, category }) {
  const where = [];
  const params = [];
  if (skinType) {
    params.push([skinType, 'all']);
    where.push(`skin_types && $${params.length}`);
  }
  if (inStock) where.push('stock > 0');
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  const sql = `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`;
  const { rows } = await pool.query(sql, params);
  return rows.map(toProduct);
}

async function findProduct(id, client = pool) {
  const { rows } = await client.query('SELECT * FROM products WHERE id = $1', [id]);
  return rows[0] ? toProduct(rows[0]) : null;
}

// xmax = 0 is true only for a freshly inserted row, which tells us created vs updated.
async function upsertProduct(id, p) {
  const { rows } = await pool.query(
    `INSERT INTO products (id, name, brand, category, description, price_cents, skin_types, stock)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, brand = EXCLUDED.brand, category = EXCLUDED.category,
       description = EXCLUDED.description, price_cents = EXCLUDED.price_cents,
       skin_types = EXCLUDED.skin_types, stock = EXCLUDED.stock, updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [id, p.name, p.brand, p.category, p.description, p.priceCents, p.skinTypes, p.stock],
  );
  return { product: toProduct(rows[0]), created: rows[0].inserted };
}

// Challenge 1: the check (stock >= quantity) and the write happen in ONE statement,
// so concurrent transactions cannot both pass the check on the same units.
async function decrementStock(client, productId, quantity) {
  const { rows } = await client.query(
    `UPDATE products SET stock = stock - $2, updated_at = now()
     WHERE id = $1 AND stock >= $2
     RETURNING *`,
    [productId, quantity],
  );
  return rows[0] ? toProduct(rows[0]) : null;
}

async function incrementStock(client, productId, quantity) {
  await client.query('UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1', [productId, quantity]);
}

// Demo only: writes an absolute value computed in application code (the unsafe pattern).
async function setStock(productId, stock) {
  await pool.query('UPDATE products SET stock = $2, updated_at = now() WHERE id = $1', [productId, stock]);
}

// Returns false when a reservation for this order already exists (makes reserve idempotent per orderId).
async function insertReservationIfAbsent(client, orderId) {
  const { rowCount } = await client.query(
    `INSERT INTO reservations (order_id, status) VALUES ($1, 'RESERVED') ON CONFLICT (order_id) DO NOTHING`,
    [orderId],
  );
  return rowCount === 1;
}

async function insertReservationItem(client, orderId, productId, quantity, unitPriceCents) {
  await client.query(
    'INSERT INTO reservation_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, $3, $4)',
    [orderId, productId, quantity, unitPriceCents],
  );
}

// Only a RESERVED reservation can be released, and only once (conditional update).
async function markReleased(client, orderId) {
  const { rowCount } = await client.query(
    `UPDATE reservations SET status = 'RELEASED', updated_at = now() WHERE order_id = $1 AND status = 'RESERVED'`,
    [orderId],
  );
  return rowCount === 1;
}

async function findReservationItems(client, orderId) {
  const { rows } = await client.query(
    `SELECT ri.product_id, ri.quantity, ri.unit_price_cents, p.name
     FROM reservation_items ri JOIN products p ON p.id = ri.product_id
     WHERE ri.order_id = $1 ORDER BY ri.product_id`,
    [orderId],
  );
  return rows.map((r) => ({
    productId: r.product_id,
    name: r.name,
    quantity: r.quantity,
    unitPriceCents: r.unit_price_cents,
  }));
}

async function findReservation(orderId, client = pool) {
  const { rows } = await client.query('SELECT * FROM reservations WHERE order_id = $1', [orderId]);
  if (!rows[0]) return null;
  return {
    orderId: rows[0].order_id,
    status: rows[0].status,
    items: await findReservationItems(client, orderId),
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at,
  };
}

module.exports = {
  listProducts,
  findProduct,
  upsertProduct,
  decrementStock,
  incrementStock,
  setStock,
  insertReservationIfAbsent,
  insertReservationItem,
  markReleased,
  findReservationItems,
  findReservation,
};
