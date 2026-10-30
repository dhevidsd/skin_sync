const test = require('node:test');
const assert = require('node:assert/strict');

// rules.js -> errors.js has no config dependency, so no environment is needed.
const { canReserve, outOfStock, normaliseReservationItems } = require('../src/rules');

test('BR1: reservation allowed only when stock covers the quantity', () => {
  assert.equal(canReserve(5, 5), true);
  assert.equal(canReserve(5, 1), true);
  assert.equal(canReserve(4, 5), false);
  assert.equal(canReserve(0, 1), false);
});

test('BR1: zero, negative and fractional quantities are never reservable', () => {
  assert.equal(canReserve(10, 0), false);
  assert.equal(canReserve(10, -2), false);
  assert.equal(canReserve(10, 1.5), false);
});

test('BR1: out-of-stock error is a 409 with requested and available units', () => {
  const err = outOfStock('p-001', 3, 1);
  assert.equal(err.status, 409);
  assert.equal(err.code, 'OUT_OF_STOCK');
  assert.deepEqual(err.details, { productId: 'p-001', requested: 3, available: 1 });
});

test('BR1: duplicate lines are merged so the total quantity is checked against stock', () => {
  const items = normaliseReservationItems([
    { productId: 'p-002', quantity: 1 },
    { productId: 'p-001', quantity: 2 },
    { productId: 'p-002', quantity: 3 },
  ]);
  assert.deepEqual(items, [
    { productId: 'p-001', quantity: 2 },
    { productId: 'p-002', quantity: 4 },
  ]);
});
