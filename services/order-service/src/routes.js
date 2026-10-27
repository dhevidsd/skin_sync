// HTTP layer: validates input, calls the services, maps results to status codes.
const express = require('express');
const { z } = require('zod');
const cart = require('./cart.service');
const orders = require('./order.service');
const { AppError, parse } = require('./errors');

const router = express.Router();

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'only letters, digits, _ and -');
// Quantity range (1-5) is a business rule (BR4) checked in rules.js, so only the type is checked here.
const quantity = z.number().int();
const idempotencyKey = z.string().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/, 'only letters, digits and _ . : -');

// ---- Cart ----
router.get('/carts/:userId', async (req, res) => {
  res.json(await cart.getCart(parse(id, req.params.userId)));
});

router.post('/carts/:userId/items', async (req, res) => {
  const body = parse(z.object({ productId: id, quantity }), req.body);
  res.status(201).json(await cart.addItem(parse(id, req.params.userId), body.productId, body.quantity));
});

router.put('/carts/:userId/items/:productId', async (req, res) => {
  const body = parse(z.object({ quantity }), req.body);
  res.json(await cart.updateItem(parse(id, req.params.userId), parse(id, req.params.productId), body.quantity));
});

router.delete('/carts/:userId/items/:productId', async (req, res) => {
  await cart.removeItem(parse(id, req.params.userId), parse(id, req.params.productId));
  res.status(204).end();
});

// ---- Orders ----
router.post('/orders', async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required');
  const body = parse(z.object({ userId: id }), req.body);
  const result = await orders.placeOrder({
    userId: body.userId,
    idempotencyKey: parse(idempotencyKey, key),
    paymentSimulation: req.get('X-Payment-Simulate'),
  });
  res.set('Idempotent-Replayed', String(result.replayed));
  res.status(result.status).json(result.body);
});

router.get('/orders', async (req, res) => {
  const { userId } = parse(z.object({ userId: id }), req.query);
  const items = await orders.listOrders(userId);
  res.json({ items, count: items.length });
});

router.get('/orders/:orderId', async (req, res) => {
  res.json(await orders.getOrder(parse(z.uuid(), req.params.orderId)));
});

router.post('/orders/:orderId/cancel', async (req, res) => {
  res.json(await orders.cancelOrder(parse(z.uuid(), req.params.orderId)));
});

module.exports = router;
