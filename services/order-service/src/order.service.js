// Order placement: orchestrates reserve stock -> charge payment -> confirm -> publish (via outbox).
const { randomUUID } = require('node:crypto');
const config = require('./config');
const log = require('./logger');
const repo = require('./repository');
const rules = require('./rules');
const { callService } = require('./http');
const { withTransaction } = require('./db');
const { AppError } = require('./errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Idempotency (Challenge 2, BR6) ----

// Returns { status, body, replayed }. The first request with a key executes the order and stores
// its response; any repeat (sequential or simultaneous) gets that stored response back.
async function placeOrder({ userId, idempotencyKey, paymentSimulation }) {
  const requestHash = rules.requestFingerprint('POST', '/api/v1/orders', { userId });
  if (!(await repo.claimIdempotencyKey(idempotencyKey, requestHash))) {
    return waitForFirstRequest(idempotencyKey, requestHash);
  }
  log.info('idempotency key claimed, executing order', { idempotencyKey, userId });

  let response;
  try {
    response = { status: 201, body: await executeOrder(userId, idempotencyKey, paymentSimulation) };
  } catch (err) {
    response = errorResponse(err);
  }
  // Failures are stored too: the outcome of a key is final, so a retry never creates a second order.
  await repo.completeIdempotencyKey(idempotencyKey, response.status, response.body);
  return { ...response, replayed: false };
}

async function waitForFirstRequest(idempotencyKey, requestHash) {
  const deadline = Date.now() + config.idempotencyWaitMs;
  for (;;) {
    const stored = await repo.findIdempotencyKey(idempotencyKey);
    if (rules.resolveExistingKey(stored, requestHash) === 'REPLAY') {
      log.info('idempotent replay: returning stored response', { idempotencyKey, orderId: stored.orderId, status: stored.responseStatus });
      return { status: stored.responseStatus, body: stored.responseBody, replayed: true };
    }
    if (Date.now() > deadline) {
      throw new AppError(409, 'REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed', { idempotencyKey });
    }
    await sleep(100);
  }
}

function errorResponse(err) {
  const correlationId = log.requestContext.getStore()?.correlationId;
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details, correlationId } } };
  }
  log.error('order placement failed unexpectedly', { error: err.message, stack: err.stack });
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', details: null, correlationId } } };
}

// ---- State machine (BR5) ----

async function transition(client, orderId, from, to, { reason = null, paymentId = null } = {}) {
  rules.assertTransition(from, to);
  const failureReason = to === 'FAILED' ? reason : null;
  if (!(await repo.updateStatus(client, orderId, from, to, { paymentId, failureReason }))) {
    throw new AppError(409, 'ILLEGAL_STATE_TRANSITION', `Order ${orderId} is no longer ${from}`, { orderId, from, to });
  }
  await repo.insertStatusHistory(client, orderId, from, to, reason);
  log.info('order status changed', { orderId, from, to, reason });
}

async function failOrder(orderId, from, reason) {
  await withTransaction((client) => transition(client, orderId, from, 'FAILED', { reason }));
}

// ---- The main transaction ----

async function executeOrder(userId, idempotencyKey, paymentSimulation) {
  const cart = await repo.getCartItems(userId);
  rules.assertCartNotEmpty(cart); // BR4

  const orderId = randomUUID();
  await withTransaction((client) => repo.insertOrder(client, { id: orderId, userId, items: cart, idempotencyKey }));
  log.info('order created', { orderId, userId, items: cart.length });

  // Step 1: reserve stock in catalog-service (BR1 is enforced there).
  const reservation = await reserveStock(orderId, cart);
  const totalCents = rules.orderTotal(reservation.items);
  await withTransaction(async (client) => {
    await transition(client, orderId, 'PENDING', 'STOCK_RESERVED');
    await repo.setItemPrices(client, orderId, reservation.items, totalCents);
  }).catch(async (err) => {
    await releaseStock(orderId); // order was cancelled meanwhile: give the stock back
    throw err;
  });

  // Step 2: charge payment-service (retried safely; failure releases the stock).
  const payment = await chargePayment(orderId, userId, totalCents, paymentSimulation);
  await withTransaction((client) => transition(client, orderId, 'STOCK_RESERVED', 'PAID', { paymentId: payment.id }));

  // Step 3: confirm. The event goes into the outbox in the SAME transaction, so it is never lost
  // and never sent for an order that did not commit.
  await withTransaction(async (client) => {
    await transition(client, orderId, 'PAID', 'CONFIRMED');
    await repo.insertOutboxEvent(client, {
      id: randomUUID(),
      aggregateId: orderId,
      eventType: 'order.confirmed',
      correlationId: log.requestContext.getStore()?.correlationId,
      payload: {
        eventType: 'order.confirmed',
        occurredAt: new Date().toISOString(),
        data: { orderId, userId, totalCents, paymentId: payment.id, items: reservation.items },
      },
    });
    await repo.removeCartItems(client, userId, cart.map((i) => i.productId));
  });
  return repo.findOrder(orderId);
}

async function reserveStock(orderId, cart) {
  let res;
  try {
    res = await callService('catalog-service', config.catalogServiceUrl, '/api/v1/reservations', {
      method: 'POST',
      body: { orderId, items: cart.map(({ productId, quantity }) => ({ productId, quantity })) },
      timeoutMs: config.httpTimeoutMs,
    });
  } catch (err) {
    // The reservation may have committed just before the timeout. Release is idempotent, so undo it to be safe.
    await releaseStock(orderId);
    await failOrder(orderId, 'PENDING', 'CATALOG_UNAVAILABLE');
    err.details = { ...err.details, orderId };
    throw err;
  }
  if (res.status === 200 || res.status === 201) return res.body;

  const error = res.body?.error || {};
  const code = error.code || 'RESERVATION_FAILED';
  await failOrder(orderId, 'PENDING', code);
  const status = res.status === 409 ? 409 : res.status >= 500 ? 502 : 422;
  throw new AppError(status, code, error.message || 'Stock reservation failed', { ...error.details, orderId });
}

// Compensation for a reservation. Failures are logged; the stock then stays reserved (documented limitation).
async function releaseStock(orderId) {
  try {
    const res = await callService('catalog-service', config.catalogServiceUrl, `/api/v1/reservations/${orderId}/release`, {
      method: 'POST',
      timeoutMs: config.httpTimeoutMs,
    });
    if (res.status === 200) log.info('compensation: reserved stock released', { orderId });
    else if (res.status !== 404) log.error('compensation: release rejected', { orderId, status: res.status });
  } catch {
    log.error('compensation failed: catalog unreachable, stock stays reserved', { orderId });
  }
}

// Retries only transient failures (timeout, unreachable, 5xx). Retrying is safe because
// payment-service charges at most once per orderId (BR6).
async function chargePayment(orderId, userId, amountCents, paymentSimulation) {
  const headers = paymentSimulation ? { 'X-Payment-Simulate': paymentSimulation } : {};
  for (let attempt = 1; ; attempt++) {
    let res = null;
    try {
      res = await callService('payment-service', config.paymentServiceUrl, '/api/v1/payments', {
        method: 'POST',
        body: { orderId, userId, amountCents },
        headers,
        timeoutMs: config.paymentTimeoutMs,
      });
    } catch {
      // timeout or unreachable: res stays null and is treated as transient
    }
    if (res && (res.status === 200 || res.status === 201)) return res.body;

    const transient = res === null || res.status >= 500;
    if (!transient || attempt >= config.paymentMaxAttempts) {
      const code = res === null ? 'PAYMENT_UNAVAILABLE' : res.body?.error?.code || 'PAYMENT_FAILED';
      await releaseStock(orderId);
      await failOrder(orderId, 'STOCK_RESERVED', code);
      const status = transient ? 503 : res.status === 402 ? 402 : 502;
      throw new AppError(status, code, res?.body?.error?.message || 'Payment could not be completed', {
        ...res?.body?.error?.details,
        orderId,
        attempts: attempt,
      });
    }
    const delayMs = rules.backoffDelay(attempt, config.paymentRetryBaseMs);
    log.warn('payment attempt failed, retrying', { orderId, attempt, status: res?.status ?? 'no response', delayMs });
    await sleep(delayMs);
  }
}

// ---- Queries and cancellation ----

async function getOrder(orderId) {
  const order = await repo.findOrder(orderId);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', `Order ${orderId} not found`, { orderId });
  return order;
}

function listOrders(userId) {
  return repo.listOrders(userId);
}

// Allowed only from PENDING or STOCK_RESERVED (e.g. an order stuck after a crash). Anything else is 409 (BR5).
async function cancelOrder(orderId) {
  const order = await getOrder(orderId);
  await withTransaction((client) => transition(client, orderId, order.status, 'CANCELLED', { reason: 'CANCELLED_BY_USER' }));
  if (order.status === 'STOCK_RESERVED') await releaseStock(orderId);
  return getOrder(orderId);
}

module.exports = { placeOrder, getOrder, listOrders, cancelOrder };
