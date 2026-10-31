// Notification rules. Pure functions only: unit-tested without a database or broker.
const { z } = require('zod');
const { AppError } = require('./errors');

const orderConfirmedEvent = z.object({
  eventType: z.literal('order.confirmed'),
  data: z.object({
    orderId: z.string().min(1),
    userId: z.string().min(1),
    totalCents: z.number().int().nonnegative(),
    items: z.array(z.object({ name: z.string().nullable().optional(), quantity: z.number().int().positive() })).min(1),
  }),
});

function formatPrice(cents) {
  return `${(cents / 100).toFixed(2)}`;
}

// Turns an order.confirmed event into the email we "send". No user service exists, so the
// recipient is a placeholder derived from the userId. Invalid events throw (they can never succeed).
function buildOrderConfirmedEmail(event) {
  const parsed = orderConfirmedEvent.safeParse(event);
  if (!parsed.success) {
    throw new AppError(422, 'INVALID_EVENT', 'order.confirmed event has an invalid shape', parsed.error.issues.map((i) => i.path.join('.')));
  }
  const { orderId, userId, totalCents, items } = parsed.data.data;
  const lines = items.map((i) => `- ${i.quantity} x ${i.name || 'item'}`).join('\n');
  return {
    orderId,
    userId,
    channel: 'EMAIL',
    recipient: `${userId}@example.com`,
    subject: `SkinSync order ${orderId.slice(0, 8)} confirmed`,
    body: `Hi ${userId}, your order is confirmed.\n${lines}\nTotal: ${formatPrice(totalCents)}`,
  };
}

module.exports = { buildOrderConfirmedEmail };
