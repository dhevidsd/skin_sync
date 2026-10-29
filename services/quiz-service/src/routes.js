// HTTP layer: validates input, calls the service, maps results to status codes.
const express = require('express');
const { z } = require('zod');
const service = require('./service');
const { parse } = require('./errors');

const router = express.Router();

const userId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'only letters, digits, _ and -');

const submissionBody = z.object({
  userId,
  answers: z.array(z.object({ questionId: z.string().min(1).max(20), optionId: z.string().min(1).max(20) })).min(1).max(20),
});

const recommendationsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(5) });

router.get('/quiz/questions', (req, res) => {
  const items = service.questions();
  res.json({ items, count: items.length });
});

router.post('/quiz/submissions', async (req, res) => {
  const body = parse(submissionBody, req.body);
  res.status(201).json(await service.submitQuiz(body.userId, body.answers));
});

router.get('/users/:userId/skin-profile', async (req, res) => {
  res.json(await service.getSkinProfile(parse(userId, req.params.userId)));
});

router.get('/users/:userId/recommendations', async (req, res) => {
  const { limit } = parse(recommendationsQuery, req.query);
  res.json(await service.getRecommendations(parse(userId, req.params.userId), limit));
});

module.exports = router;
