const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSimulation, decideOutcome, assertSameCharge } = require('../src/rules');

const original = { orderId: 'o-1', userId: 'u-1', amountCents: 2500 };

test('BR6: repeated charge with identical details is accepted (caller gets the original payment)', () => {
  assert.doesNotThrow(() => assertSameCharge(original, { ...original }));
});

test('BR6: same orderId with a different amount is rejected with 422', () => {
  assert.throws(
    () => assertSameCharge(original, { ...original, amountCents: 9999 }),
    (err) => err.status === 422 && err.code === 'IDEMPOTENCY_MISMATCH',
  );
});

test('BR6: same orderId for a different user is rejected with 422', () => {
  assert.throws(() => assertSameCharge(original, { ...original, userId: 'u-2' }), (err) => err.status === 422);
});

test('mock gateway: forced outcomes override the random failure rate', () => {
  assert.equal(decideOutcome({ outcome: 'fail' }, 0).status, 'DECLINED');
  assert.equal(decideOutcome({ outcome: 'success' }, 1).status, 'SUCCEEDED');
});

test('mock gateway: failure rate is applied when no outcome is forced', () => {
  assert.equal(decideOutcome({ outcome: null }, 0.3, () => 0.1).status, 'DECLINED');
  assert.equal(decideOutcome({ outcome: null }, 0.3, () => 0.9).status, 'SUCCEEDED');
});

test('mock gateway: simulation header parsing', () => {
  assert.deepEqual(parseSimulation(undefined), { outcome: null, delayMs: null });
  assert.deepEqual(parseSimulation('delay=3000,fail'), { outcome: 'fail', delayMs: 3000 });
  assert.throws(() => parseSimulation('explode'), (err) => err.status === 400);
});
