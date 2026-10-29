// End-to-end test of the main transaction across all five services, plus failure cases.
//   quiz -> recommendations -> cart -> place order -> CONFIRMED -> notification
//   failure: forced payment decline -> order FAILED and stock released
// Usage: node scripts/e2e.js
const { URLS, api, runId, waitFor, createEvidence } = require('./lib/common');

const RUN = runId();
const ev = createEvidence('tests', 'e2e');
const H = (name) => ({ 'X-Correlation-Id': `e2e-${RUN}-${name}` });

async function stockOf(productId) {
  return (await api('GET', `${URLS.catalog}/api/v1/products/${productId}`)).body.stock;
}

async function happyPath() {
  const userId = `e2e-${RUN}-alice`;
  ev.section(`Happy path for ${userId}`);

  const questions = await api('GET', `${URLS.quiz}/api/v1/quiz/questions`);
  ev.check(questions.status === 200 && questions.body.count === 5, `GET quiz questions -> ${questions.status}, ${questions.body.count} questions`);

  const oilyAnswers = { q1: 'b', q2: 'a', q3: 'c', q4: 'a', q5: 'c' };
  const quiz = await api('POST', `${URLS.quiz}/api/v1/quiz/submissions`, {
    body: { userId, answers: Object.entries(oilyAnswers).map(([questionId, optionId]) => ({ questionId, optionId })) },
    headers: H('quiz'),
  });
  ev.log('Quiz result:', quiz.status, { skinType: quiz.body.skinType, scores: quiz.body.scores });
  ev.check(quiz.status === 201 && quiz.body.skinType === 'oily', 'BR2: answers scored to exactly one skin type (oily)');

  const recs = await api('GET', `${URLS.quiz}/api/v1/users/${userId}/recommendations?limit=5`, { headers: H('recs') });
  ev.table(recs.body.items.map((p) => ({ id: p.id, name: p.name, skinTypes: p.skinTypes.join(','), stock: p.stock, priceCents: p.priceCents })));
  ev.check(
    recs.status === 200 && recs.body.items.length > 0 && recs.body.items.every((p) => p.stock > 0 && (p.skinTypes.includes('oily') || p.skinTypes.includes('all'))),
    'BR3: recommendations are in stock and tagged oily or all',
  );

  const [a, b] = recs.body.items;
  ev.log(`Adding ${a.id} x2 and ${b.id} x1 to the cart`);
  await api('POST', `${URLS.order}/api/v1/carts/${userId}/items`, { body: { productId: a.id, quantity: 2 }, headers: H('cart-1') });
  const cart = await api('POST', `${URLS.order}/api/v1/carts/${userId}/items`, { body: { productId: b.id, quantity: 1 }, headers: H('cart-2') });
  ev.log('Cart:', cart.body);
  ev.check(cart.status === 201 && cart.body.totalQuantity === 3, 'cart holds 3 units');

  const tooMany = await api('POST', `${URLS.order}/api/v1/carts/${userId}/items`, { body: { productId: a.id, quantity: 4 }, headers: H('cart-too-many') });
  ev.log('Adding 4 more of the first product:', tooMany.status, tooMany.body.error);
  ev.check(tooMany.status === 422 && tooMany.body.error.code === 'CART_QUANTITY_OUT_OF_RANGE', 'BR4: quantity above 5 per item rejected with 422');

  const stockBefore = { [a.id]: await stockOf(a.id), [b.id]: await stockOf(b.id) };
  const order = await api('POST', `${URLS.order}/api/v1/orders`, {
    body: { userId },
    headers: { ...H('order'), 'Idempotency-Key': `e2e-${RUN}-alice-order-1`, 'X-Payment-Simulate': 'success' },
  });
  ev.log('Place order:', order.status, { id: order.body.id, status: order.body.status, totalCents: order.body.totalCents, paymentId: order.body.paymentId });
  ev.check(order.status === 201 && order.body.status === 'CONFIRMED', 'order placed and CONFIRMED');
  ev.check(order.body.totalCents === a.priceCents * 2 + b.priceCents, `total = ${a.priceCents} x 2 + ${b.priceCents} = ${a.priceCents * 2 + b.priceCents}`);

  const fetched = await api('GET', `${URLS.order}/api/v1/orders/${order.body.id}`);
  ev.log('Status history:', fetched.body.history.map((h) => `${h.from || '-'} -> ${h.to}`).join(', '));
  ev.check(
    JSON.stringify(fetched.body.history.map((h) => h.to)) === JSON.stringify(['PENDING', 'STOCK_RESERVED', 'PAID', 'CONFIRMED']),
    'BR5: order went PENDING -> STOCK_RESERVED -> PAID -> CONFIRMED',
  );
  ev.check(
    (await stockOf(a.id)) === stockBefore[a.id] - 2 && (await stockOf(b.id)) === stockBefore[b.id] - 1,
    'BR1: catalog stock reduced by exactly the ordered quantities',
  );
  ev.check((await api('GET', `${URLS.order}/api/v1/carts/${userId}`)).body.items.length === 0, 'cart emptied after confirmation');

  const payment = await api('GET', `${URLS.payment}/api/v1/payments?orderId=${order.body.id}`);
  ev.check(payment.body.count === 1 && payment.body.items[0].status === 'SUCCEEDED', 'BR6: exactly one SUCCEEDED payment for the order');

  const notification = await waitFor(async () => {
    const r = await api('GET', `${URLS.notification}/api/v1/notifications?orderId=${order.body.id}`);
    return r.body.items[0];
  }, { timeoutMs: 15000 });
  if (notification) ev.log('Notification:', { recipient: notification.recipient, subject: notification.subject });
  ev.check(Boolean(notification), 'order.confirmed event delivered via RabbitMQ and notification stored');
  if (!notification) {
    const h = (await api('GET', `${URLS.order}/health`)).body;
    ev.log('order-service health:', h, '(if broker is DOWN the event is safe in the outbox and is sent once RabbitMQ is up)');
  }

  const cancel = await api('POST', `${URLS.order}/api/v1/orders/${order.body.id}/cancel`, { headers: H('cancel') });
  ev.log('Cancel the CONFIRMED order:', cancel.status, cancel.body.error);
  ev.check(cancel.status === 409 && cancel.body.error.code === 'ILLEGAL_STATE_TRANSITION', 'BR5: illegal transition CONFIRMED -> CANCELLED rejected with 409');

  const empty = await api('POST', `${URLS.order}/api/v1/orders`, {
    body: { userId },
    headers: { ...H('empty'), 'Idempotency-Key': `e2e-${RUN}-alice-order-2` },
  });
  ev.check(empty.status === 422 && empty.body.error.code === 'EMPTY_CART', 'BR4: order with an empty cart rejected with 422');
}

async function paymentFailure() {
  const userId = `e2e-${RUN}-bob`;
  ev.section(`Failure path for ${userId}: payment declined -> order FAILED, stock released`);
  const productId = 'p-004';
  await api('POST', `${URLS.order}/api/v1/carts/${userId}/items`, { body: { productId, quantity: 2 } });
  const before = await stockOf(productId);

  const order = await api('POST', `${URLS.order}/api/v1/orders`, {
    body: { userId },
    headers: { ...H('declined'), 'Idempotency-Key': `e2e-${RUN}-bob-order-1`, 'X-Payment-Simulate': 'fail' },
  });
  ev.log('Place order with forced payment failure:', order.status, order.body.error);
  ev.check(order.status === 402 && order.body.error.code === 'PAYMENT_DECLINED', 'client gets 402 PAYMENT_DECLINED');

  const orderId = order.body.error.details.orderId;
  const fetched = await api('GET', `${URLS.order}/api/v1/orders/${orderId}`);
  ev.log('Status history:', fetched.body.history.map((h) => `${h.from || '-'} -> ${h.to}${h.reason ? ` (${h.reason})` : ''}`).join(', '));
  ev.check(fetched.body.status === 'FAILED' && fetched.body.failureReason === 'PAYMENT_DECLINED', 'order is FAILED with reason PAYMENT_DECLINED');

  const after = await stockOf(productId);
  const reservation = await api('GET', `${URLS.catalog}/api/v1/reservations/${orderId}`);
  ev.log(`Stock of ${productId}: before=${before}, after=${after}; reservation status=${reservation.body.status}`);
  ev.check(after === before && reservation.body.status === 'RELEASED', 'compensation: reserved stock released back to the catalog');

  const cart = await api('GET', `${URLS.order}/api/v1/carts/${userId}`);
  ev.check(cart.body.items.length === 1, 'cart is kept so the user can retry with a new Idempotency-Key');
}

async function main() {
  ev.section('Health of all services');
  for (const [name, url] of Object.entries(URLS)) {
    const h = await api('GET', `${url}/health`).catch(() => null);
    ev.log(`${name.padEnd(13)} ${h ? JSON.stringify(h.body) : 'NOT REACHABLE'}`);
    if (!h || h.status !== 200) throw new Error(`${name} is not healthy at ${url}`);
  }
  await happyPath();
  await paymentFailure();
  process.exit(ev.finish() ? 0 : 1);
}

main().catch((err) => {
  ev.log(`ERROR: ${err.message}`);
  ev.finish();
  process.exit(1);
});
