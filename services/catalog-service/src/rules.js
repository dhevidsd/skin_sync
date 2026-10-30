// Catalog business rules. Pure functions only: unit-tested without a database.
const { AppError } = require('./errors');

const SKIN_TYPES = ['oily', 'dry', 'combination', 'normal', 'sensitive'];
const PRODUCT_TAGS = [...SKIN_TYPES, 'all'];

// BR1: a reservation is only allowed when enough stock is available, so stock never goes below zero.
// The atomic SQL in repository.decrementStock applies the same condition inside the database.
function canReserve(stock, quantity) {
  return Number.isInteger(quantity) && quantity > 0 && stock >= quantity;
}

function outOfStock(productId, requested, available) {
  return new AppError(409, 'OUT_OF_STOCK', `Not enough stock for product ${productId}`, {
    productId,
    requested,
    available,
  });
}

// Merges duplicate product lines and sorts by productId. A fixed lock order prevents
// deadlocks when two transactions reserve overlapping products.
function normaliseReservationItems(items) {
  const totals = new Map();
  for (const { productId, quantity } of items) {
    totals.set(productId, (totals.get(productId) || 0) + quantity);
  }
  return [...totals.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

module.exports = { SKIN_TYPES, PRODUCT_TAGS, canReserve, outOfStock, normaliseReservationItems };
