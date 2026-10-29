// Quiz business logic: scoring, skin profiles and recommendations.
const config = require('./config');
const log = require('./logger');
const repo = require('./repository');
const rules = require('./rules');
const { callService } = require('./http');
const { AppError } = require('./errors');

async function submitQuiz(userId, answers) {
  const { skinType, scores } = rules.scoreAnswers(answers);
  const result = await repo.insertResult({ userId, skinType, answers, scores });
  log.info('quiz scored', { userId, skinType, scores });
  return result;
}

async function getSkinProfile(userId) {
  const result = await repo.findLatestByUser(userId);
  if (!result) {
    throw new AppError(404, 'SKIN_PROFILE_NOT_FOUND', `User ${userId} has not taken the quiz yet`, { userId });
  }
  return result;
}

async function getRecommendations(userId, limit) {
  const profile = await getSkinProfile(userId);
  const query = new URLSearchParams({ skinType: profile.skinType, inStock: 'true' });
  const res = await callService('catalog-service', config.catalogServiceUrl, `/api/v1/products?${query}`, {
    timeoutMs: config.httpTimeoutMs,
  });
  if (res.status !== 200) {
    throw new AppError(502, 'BAD_GATEWAY', 'catalog-service returned an unexpected response', { status: res.status });
  }
  const items = rules.selectRecommendations(res.body.items, profile.skinType, limit);
  return { userId, skinType: profile.skinType, items, count: items.length };
}

module.exports = { submitQuiz, getSkinProfile, getRecommendations, questions: rules.publicQuestions };
