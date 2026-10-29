// Mock payment gateway logic.
const config = require('./config');
const log = require('./logger');
const repo = require('./repository');
const rules = require('./rules');
const { AppError } = require('./errors');

// BR6: charges at most once per orderId. Returns { payment, replayed }.
async function charge(request, simulation) {
  const existing = await repo.findByOrderId(request.orderId);
  if (existing) {
    rules.assertSameCharge(existing, request);
    log.info('duplicate charge request, returning original payment', { orderId: request.orderId, paymentId: existing.id });
    return { payment: existing, replayed: true };
  }

  const delayMs = simulation.delayMs ?? config.latencyMs;
  await new Promise((r) => setTimeout(r, delayMs));

  if (simulation.outcome === 'error') {
    log.warn('simulated gateway error, nothing recorded', { orderId: request.orderId });
    throw new AppError(503, 'GATEWAY_UNAVAILABLE', 'Simulated payment gateway error, retry later');
  }

  const outcome = rules.decideOutcome(simulation, config.failureRate);
  const payment = await repo.insertIfAbsent({ ...request, ...outcome });
  if (!payment) {
    // A concurrent duplicate for the same order won the insert; return its result.
    const winner = await repo.findByOrderId(request.orderId);
    rules.assertSameCharge(winner, request);
    log.info('concurrent duplicate charge request, returning original payment', { orderId: request.orderId, paymentId: winner.id });
    return { payment: winner, replayed: true };
  }
  log.info('payment processed', { orderId: payment.orderId, paymentId: payment.id, status: payment.status, amountCents: payment.amountCents, delayMs });
  return { payment, replayed: false };
}

async function getPayment(id) {
  const payment = await repo.findById(id);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', `Payment ${id} not found`, { paymentId: id });
  return payment;
}

async function findPaymentsForOrder(orderId) {
  const payment = await repo.findByOrderId(orderId);
  return payment ? [payment] : [];
}

module.exports = { charge, getPayment, findPaymentsForOrder };
