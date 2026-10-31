const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderConfirmedEmail } = require('../src/rules');

const event = {
  eventType: 'order.confirmed',
  occurredAt: '2026-01-01T00:00:00.000Z',
  data: {
    orderId: '6f1c2a9e-0d7b-4a51-9a51-2f7f3c1d9b10',
    userId: 'user-42',
    totalCents: 3598,
    paymentId: 'pay-1',
    items: [{ productId: 'p-001', name: 'Gentle Foaming Cleanser', quantity: 2, unitPriceCents: 1799 }],
  },
};

test('order.confirmed event becomes one email for the ordering user', () => {
  const email = buildOrderConfirmedEmail(event);
  assert.equal(email.channel, 'EMAIL');
  assert.equal(email.orderId, event.data.orderId);
  assert.equal(email.recipient, 'user-42@example.com');
  assert.match(email.subject, /6f1c2a9e confirmed/);
  assert.match(email.body, /2 x Gentle Foaming Cleanser/);
  assert.match(email.body, /Total: 35\.98/);
});

test('the same event always produces the same email (safe to rebuild on redelivery)', () => {
  assert.deepEqual(buildOrderConfirmedEmail(event), buildOrderConfirmedEmail(structuredClone(event)));
});

test('malformed events are rejected so they are not retried forever', () => {
  assert.throws(() => buildOrderConfirmedEmail({ eventType: 'order.confirmed', data: {} }), (e) => e.code === 'INVALID_EVENT');
  assert.throws(() => buildOrderConfirmedEmail({ ...event, eventType: 'order.cancelled' }), (e) => e.code === 'INVALID_EVENT');
});
