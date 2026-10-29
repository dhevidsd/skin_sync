// HTTP layer: validates input, calls the service, maps results to status codes.
const express = require('express');
const { z } = require('zod');
const config = require('./config');
const service = require('./service');
const rules = require('./rules');
const { parse } = require('./errors');

const router = express.Router();

const chargeBody = z.object({
  orderId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  amountCents: z.number().int().positive().max(100_000_000),
});

function sendPayment(res, payment, replayed) {
  if (replayed) res.set('Idempotent-Replayed', 'true');
  if (payment.status === 'DECLINED') {
    return res.status(402).json({
      error: {
        code: 'PAYMENT_DECLINED',
        message: `Payment for order ${payment.orderId} was declined`,
        details: { paymentId: payment.id, orderId: payment.orderId, reason: payment.failureReason },
        correlationId: res.get('X-Correlation-Id'),
      },
    });
  }
  return res.status(replayed ? 200 : 201).json(payment);
}

router.post('/payments', async (req, res) => {
  const body = parse(chargeBody, req.body);
  const simulation = rules.parseSimulation(config.allowSimulationHeader ? req.get('X-Payment-Simulate') : null);
  const { payment, replayed } = await service.charge(body, simulation);
  sendPayment(res, payment, replayed);
});

router.get('/payments', async (req, res) => {
  const { orderId } = parse(z.object({ orderId: z.string().min(1).max(64) }), req.query);
  const items = await service.findPaymentsForOrder(orderId);
  res.json({ items, count: items.length });
});

router.get('/payments/:paymentId', async (req, res) => {
  res.json(await service.getPayment(parse(z.uuid(), req.params.paymentId)));
});

module.exports = router;
