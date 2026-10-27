// Order business rules. Pure functions only: unit-tested without a database.
const { createHash } = require('node:crypto');
const { AppError } = require('./errors');

// ---- BR4: cart limits ----
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 5;

function assertCartQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    throw new AppError(422, 'CART_QUANTITY_OUT_OF_RANGE', `Quantity per item must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}`, {
      quantity,
      min: MIN_QUANTITY,
      max: MAX_QUANTITY,
    });
  }
  return quantity;
}

// Adding a product that is already in the cart increases its quantity; the total must stay within limits.
function mergedQuantity(currentQuantity, addedQuantity) {
  assertCartQuantity(addedQuantity);
  return assertCartQuantity(currentQuantity + addedQuantity);
}

function assertCartNotEmpty(items) {
  if (items.length === 0) throw new AppError(422, 'EMPTY_CART', 'Cannot place an order with an empty cart');
}

// ---- BR5: order state machine ----
const TRANSITIONS = {
  PENDING: ['STOCK_RESERVED', 'FAILED', 'CANCELLED'],
  STOCK_RESERVED: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['CONFIRMED'],
  CONFIRMED: [],
  FAILED: [],
  CANCELLED: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'ILLEGAL_STATE_TRANSITION', `Order cannot move from ${from} to ${to}`, {
      from,
      to,
      allowed: TRANSITIONS[from] || [],
    });
  }
}

// ---- BR6: idempotent order placement ----
// Canonical JSON (sorted keys) so the same request always gives the same fingerprint.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint(method, path, body) {
  return createHash('sha256').update(`${method} ${path} ${canonicalJson(body)}`).digest('hex');
}

// Decides what to do when an Idempotency-Key already exists.
// Returns 'REPLAY' (send stored response) or 'WAIT' (first request still running).
function resolveExistingKey(stored, requestHash) {
  if (stored.requestHash !== requestHash) {
    throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request body');
  }
  return stored.status === 'COMPLETED' ? 'REPLAY' : 'WAIT';
}

// ---- Totals and retries ----
function orderTotal(items) {
  return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

// Exponential backoff with jitter: base * 2^(attempt-1), randomised between 50% and 100%
// so that many clients retrying at once do not hit the payment service in lock-step.
function backoffDelay(attempt, baseMs, random = Math.random) {
  const exp = baseMs * 2 ** (attempt - 1);
  return Math.round(exp / 2 + (random() * exp) / 2);
}

module.exports = {
  MAX_QUANTITY,
  TRANSITIONS,
  assertCartQuantity,
  mergedQuantity,
  assertCartNotEmpty,
  canTransition,
  assertTransition,
  requestFingerprint,
  resolveExistingKey,
  orderTotal,
  backoffDelay,
};
