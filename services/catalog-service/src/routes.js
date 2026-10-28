// HTTP layer: validates input, calls the service, maps results to status codes.
const express = require('express');
const { z } = require('zod');
const config = require('./config');
const service = require('./service');
const { PRODUCT_TAGS } = require('./rules');
const { parse } = require('./errors');

const router = express.Router();

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'only letters, digits, _ and -');

const listQuery = z.object({
  skinType: z.enum(PRODUCT_TAGS).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  category: z.string().min(1).max(50).optional(),
});

const productBody = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  description: z.string().max(1000).default(''),
  priceCents: z.number().int().positive(),
  skinTypes: z.array(z.enum(PRODUCT_TAGS)).min(1),
  stock: z.number().int().min(0),
});

const reservationBody = z.object({
  orderId: id,
  items: z.array(z.object({ productId: id, quantity: z.number().int().positive().max(1000) })).min(1).max(50),
});

const naiveBody = z.object({ productId: id, quantity: z.number().int().positive() });

router.get('/products', async (req, res) => {
  const q = parse(listQuery, req.query);
  const items = await service.listProducts({ ...q, inStock: q.inStock === 'true' });
  res.json({ items, count: items.length });
});

router.get('/products/:productId', async (req, res) => {
  res.json(await service.getProduct(parse(id, req.params.productId)));
});

// Create or replace a product (used by the seed script and to restock).
router.put('/products/:productId', async (req, res) => {
  const { product, created } = await service.upsertProduct(parse(id, req.params.productId), parse(productBody, req.body));
  res.status(created ? 201 : 200).json(product);
});

router.post('/reservations', async (req, res) => {
  const body = parse(reservationBody, req.body);
  const { reservation, created } = await service.reserveStock(body.orderId, body.items);
  res.status(created ? 201 : 200).json(reservation);
});

router.get('/reservations/:orderId', async (req, res) => {
  res.json(await service.getReservation(parse(id, req.params.orderId)));
});

router.post('/reservations/:orderId/release', async (req, res) => {
  res.json(await service.releaseStock(parse(id, req.params.orderId)));
});

if (config.enableNaiveDemo) {
  router.post('/demo/naive-reservations', async (req, res) => {
    const body = parse(naiveBody, req.body);
    res.json(await service.naiveReserve(body.productId, body.quantity));
  });
}

module.exports = router;
