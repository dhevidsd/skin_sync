// Catalog business logic: uses rules.js for decisions and repository.js for data.
const config = require('./config');
const log = require('./logger');
const repo = require('./repository');
const rules = require('./rules');
const { withTransaction } = require('./db');
const { AppError } = require('./errors');

function productNotFound(productId) {
  return new AppError(404, 'PRODUCT_NOT_FOUND', `Product ${productId} not found`, { productId });
}

function listProducts(filters) {
  return repo.listProducts(filters);
}

async function getProduct(id) {
  const product = await repo.findProduct(id);
  if (!product) throw productNotFound(id);
  return product;
}

function upsertProduct(id, data) {
  return repo.upsertProduct(id, data);
}

// Reserves every item for an order in one transaction: all items are reserved or none are.
// Calling it again with the same orderId returns the existing reservation (safe to retry).
async function reserveStock(orderId, rawItems) {
  const items = rules.normaliseReservationItems(rawItems);
  const created = await withTransaction(async (client) => {
    if (!(await repo.insertReservationIfAbsent(client, orderId))) return false;
    for (const item of items) {
      const product = await repo.decrementStock(client, item.productId, item.quantity);
      if (!product) {
        const current = await repo.findProduct(item.productId, client);
        if (!current) throw productNotFound(item.productId);
        throw rules.outOfStock(item.productId, item.quantity, current.stock);
      }
      await repo.insertReservationItem(client, orderId, item.productId, item.quantity, product.priceCents);
    }
    return true;
  });

  const reservation = await repo.findReservation(orderId);
  if (!created && reservation.status === 'RELEASED') {
    throw new AppError(409, 'RESERVATION_RELEASED', `Reservation for order ${orderId} was already released`, { orderId });
  }
  log.info(created ? 'stock reserved' : 'reservation already exists, returning it', { orderId, items });
  return { reservation, created };
}

// Gives the reserved units back. Releasing twice is a no-op, so retries are safe.
async function releaseStock(orderId) {
  const released = await withTransaction(async (client) => {
    if (!(await repo.markReleased(client, orderId))) return false;
    for (const item of await repo.findReservationItems(client, orderId)) {
      await repo.incrementStock(client, item.productId, item.quantity);
    }
    return true;
  });

  const reservation = await repo.findReservation(orderId);
  if (!reservation) {
    throw new AppError(404, 'RESERVATION_NOT_FOUND', `No reservation for order ${orderId}`, { orderId });
  }
  log.info(released ? 'stock released' : 'reservation already released', { orderId });
  return reservation;
}

async function getReservation(orderId) {
  const reservation = await repo.findReservation(orderId);
  if (!reservation) {
    throw new AppError(404, 'RESERVATION_NOT_FOUND', `No reservation for order ${orderId}`, { orderId });
  }
  return reservation;
}

// Challenge 1 counter-example: check-then-update in application code. Two requests can both
// read the same stock, both pass the check and both write, so more units are sold than exist.
async function naiveReserve(productId, quantity) {
  const product = await repo.findProduct(productId);
  if (!product) throw productNotFound(productId);
  if (!rules.canReserve(product.stock, quantity)) throw rules.outOfStock(productId, quantity, product.stock);
  await new Promise((r) => setTimeout(r, config.naiveDemoDelayMs)); // widens the race window so the bug is reproducible
  const newStock = product.stock - quantity;
  await repo.setStock(productId, newStock);
  log.warn('naive reservation (no locking)', { productId, quantity, stockRead: product.stock, stockWritten: newStock });
  return { productId, quantity, stockRead: product.stock, stockWritten: newStock };
}

module.exports = { listProducts, getProduct, upsertProduct, reserveStock, releaseStock, getReservation, naiveReserve };
