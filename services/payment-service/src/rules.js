// Payment business rules. Pure functions only: unit-tested without a database.
const { AppError } = require('./errors');

// Parses the demo header X-Payment-Simulate, e.g. "fail", "success", "error", "delay=3000" or "delay=3000,fail".
function parseSimulation(header) {
  const simulation = { outcome: null, delayMs: null };
  if (!header) return simulation;
  for (const part of header.split(',').map((p) => p.trim().toLowerCase())) {
    if (['fail', 'success', 'error'].includes(part)) {
      simulation.outcome = part;
    } else if (/^delay=\d{1,5}$/.test(part)) {
      simulation.delayMs = Number(part.slice('delay='.length));
    } else {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid X-Payment-Simulate header', {
        allowed: ['fail', 'success', 'error', 'delay=<ms>'],
      });
    }
  }
  return simulation;
}

// Decides what the mock gateway answers. `random` is injectable so tests are deterministic.
function decideOutcome(simulation, failureRate, random = Math.random) {
  if (simulation.outcome === 'fail') return { status: 'DECLINED', failureReason: 'FORCED_FAILURE' };
  if (simulation.outcome === 'success') return { status: 'SUCCEEDED', failureReason: null };
  if (random() < failureRate) return { status: 'DECLINED', failureReason: 'CARD_DECLINED' };
  return { status: 'SUCCEEDED', failureReason: null };
}

// BR6: a repeated charge for the same order returns the original payment, but only if it
// asks for the same thing. A different amount or user under the same orderId is rejected.
function assertSameCharge(existing, request) {
  if (existing.amountCents !== request.amountCents || existing.userId !== request.userId) {
    throw new AppError(422, 'IDEMPOTENCY_MISMATCH', `Order ${request.orderId} was already charged with different details`, {
      orderId: request.orderId,
      existingAmountCents: existing.amountCents,
      requestedAmountCents: request.amountCents,
    });
  }
}

module.exports = { parseSimulation, decideOutcome, assertSameCharge };
