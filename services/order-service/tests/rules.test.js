const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/rules');

// ---- BR4 ----
test('BR4: cart quantity per item must be between 1 and 5', () => {
  for (const q of [1, 3, 5]) assert.equal(rules.assertCartQuantity(q), q);
  for (const q of [0, 6, -1, 2.5]) {
    assert.throws(() => rules.assertCartQuantity(q), (e) => e.status === 422 && e.code === 'CART_QUANTITY_OUT_OF_RANGE');
  }
});

test('BR4: adding to an existing line cannot push it above 5', () => {
  assert.equal(rules.mergedQuantity(3, 2), 5);
  assert.throws(() => rules.mergedQuantity(4, 2), (e) => e.code === 'CART_QUANTITY_OUT_OF_RANGE');
});

test('BR4: an order cannot be placed with an empty cart', () => {
  assert.throws(() => rules.assertCartNotEmpty([]), (e) => e.status === 422 && e.code === 'EMPTY_CART');
  assert.doesNotThrow(() => rules.assertCartNotEmpty([{ productId: 'p-001', quantity: 1 }]));
});

// ---- BR5 ----
test('BR5: the happy path PENDING -> STOCK_RESERVED -> PAID -> CONFIRMED is allowed', () => {
  assert.equal(rules.canTransition('PENDING', 'STOCK_RESERVED'), true);
  assert.equal(rules.canTransition('STOCK_RESERVED', 'PAID'), true);
  assert.equal(rules.canTransition('PAID', 'CONFIRMED'), true);
});

test('BR5: failure and cancellation are only allowed before payment', () => {
  assert.equal(rules.canTransition('PENDING', 'FAILED'), true);
  assert.equal(rules.canTransition('STOCK_RESERVED', 'FAILED'), true);
  assert.equal(rules.canTransition('STOCK_RESERVED', 'CANCELLED'), true);
  assert.equal(rules.canTransition('PAID', 'CANCELLED'), false);
  assert.equal(rules.canTransition('PAID', 'FAILED'), false);
});

test('BR5: illegal transitions are rejected with 409 (skipping steps, leaving final states)', () => {
  const illegal = [
    ['PENDING', 'PAID'],
    ['PENDING', 'CONFIRMED'],
    ['CONFIRMED', 'CANCELLED'],
    ['FAILED', 'STOCK_RESERVED'],
    ['CANCELLED', 'PENDING'],
  ];
  for (const [from, to] of illegal) {
    assert.throws(() => rules.assertTransition(from, to), (e) => e.status === 409 && e.code === 'ILLEGAL_STATE_TRANSITION');
  }
});

test('BR5: CONFIRMED, FAILED and CANCELLED are final states', () => {
  for (const state of ['CONFIRMED', 'FAILED', 'CANCELLED']) assert.deepEqual(rules.TRANSITIONS[state], []);
});

// ---- BR6 ----
test('BR6: request fingerprint is stable and ignores key order', () => {
  const a = rules.requestFingerprint('POST', '/api/v1/orders', { userId: 'u1', note: 'x' });
  const b = rules.requestFingerprint('POST', '/api/v1/orders', { note: 'x', userId: 'u1' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, rules.requestFingerprint('POST', '/api/v1/orders', { userId: 'u2' }));
});

test('BR6: a repeated key with the same request replays, or waits while the first is running', () => {
  const hash = rules.requestFingerprint('POST', '/api/v1/orders', { userId: 'u1' });
  assert.equal(rules.resolveExistingKey({ requestHash: hash, status: 'COMPLETED' }, hash), 'REPLAY');
  assert.equal(rules.resolveExistingKey({ requestHash: hash, status: 'IN_PROGRESS' }, hash), 'WAIT');
});

test('BR6: a repeated key with a different payload is rejected with 422', () => {
  const stored = { requestHash: rules.requestFingerprint('POST', '/api/v1/orders', { userId: 'u1' }), status: 'COMPLETED' };
  const other = rules.requestFingerprint('POST', '/api/v1/orders', { userId: 'u2' });
  assert.throws(() => rules.resolveExistingKey(stored, other), (e) => e.status === 422 && e.code === 'IDEMPOTENCY_KEY_REUSED');
});

// ---- Supporting rules ----
test('order total is the sum of unit price x quantity', () => {
  assert.equal(rules.orderTotal([{ unitPriceCents: 1299, quantity: 2 }, { unitPriceCents: 500, quantity: 1 }]), 3098);
});

test('retry backoff grows exponentially and stays within its jitter band', () => {
  assert.equal(rules.backoffDelay(1, 200, () => 0), 100);
  assert.equal(rules.backoffDelay(1, 200, () => 1), 200);
  assert.equal(rules.backoffDelay(3, 200, () => 0), 400);
  assert.equal(rules.backoffDelay(3, 200, () => 1), 800);
});
