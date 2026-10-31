// HTTP layer: validates input, calls the service.
const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { parse } = require('./errors');

const router = express.Router();

const listQuery = z.object({
  userId: z.string().min(1).max(64).optional(),
  orderId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

router.get('/notifications', async (req, res) => {
  const items = await service.listNotifications(parse(listQuery, req.query));
  res.json({ items, count: items.length });
});

router.get('/notifications/:id', async (req, res) => {
  res.json(await service.getNotification(parse(z.uuid(), req.params.id)));
});

module.exports = router;
