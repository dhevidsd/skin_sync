const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreAnswers, selectRecommendations, QUESTIONS } = require('../src/rules');

const answer = (pairs) => Object.entries(pairs).map(([questionId, optionId]) => ({ questionId, optionId }));

test('BR2: clearly oily answers map to oily', () => {
  const { skinType } = scoreAnswers(answer({ q1: 'b', q2: 'a', q3: 'c', q4: 'a', q5: 'c' }));
  assert.equal(skinType, 'oily');
});

test('BR2: clearly dry answers map to dry', () => {
  assert.equal(scoreAnswers(answer({ q1: 'a', q2: 'd', q3: 'c', q4: 'c', q5: 'a' })).skinType, 'dry');
});

test('BR2: reactive answers map to sensitive', () => {
  assert.equal(scoreAnswers(answer({ q1: 'e', q2: 'c', q3: 'a', q4: 'c', q5: 'd' })).skinType, 'sensitive');
});

test('BR2: same answers always give the same single skin type (deterministic)', () => {
  const answers = answer({ q1: 'c', q2: 'b', q3: 'b', q4: 'b', q5: 'b' });
  const first = scoreAnswers(answers);
  for (let i = 0; i < 10; i++) assert.deepEqual(scoreAnswers(answers), first);
  assert.equal(first.skinType, 'combination');
});

test('BR2: ties are broken by a fixed priority, never by input order', () => {
  // These answers give dry = 4 and normal = 4; TIE_BREAK_ORDER ranks dry before normal.
  const a = answer({ q1: 'a', q2: 'c', q3: 'c', q4: 'c', q5: 'd' });
  const { skinType, scores } = scoreAnswers(a);
  assert.equal(scores.dry, scores.normal);
  assert.equal(skinType, 'dry');
  assert.equal(scoreAnswers([...a].reverse()).skinType, 'dry');
});

test('BR2: every question must be answered', () => {
  assert.throws(
    () => scoreAnswers(answer({ q1: 'a', q2: 'a' })),
    (err) => err.status === 422 && err.code === 'INCOMPLETE_QUIZ' && err.details.missing.length === QUESTIONS.length - 2,
  );
});

test('BR2: unknown questions, invalid options and duplicate answers are rejected', () => {
  const full = answer({ q1: 'a', q2: 'a', q3: 'a', q4: 'a', q5: 'a' });
  assert.throws(() => scoreAnswers([...full, { questionId: 'q9', optionId: 'a' }]), (e) => e.code === 'UNKNOWN_QUESTION');
  assert.throws(() => scoreAnswers([{ questionId: 'q1', optionId: 'z' }, ...full.slice(1)]), (e) => e.code === 'INVALID_OPTION');
  assert.throws(() => scoreAnswers([...full, { questionId: 'q1', optionId: 'b' }]), (e) => e.code === 'DUPLICATE_ANSWER');
});

const product = (id, name, skinTypes, stock) => ({ id, name, skinTypes, stock });

test('BR3: only in-stock products tagged for the skin type or "all" are recommended', () => {
  const products = [
    product('p1', 'Oil Control Gel', ['oily'], 10),
    product('p2', 'Rich Cream', ['dry'], 10),
    product('p3', 'Daily SPF', ['all'], 10),
    product('p4', 'Sold Out Toner', ['oily'], 0),
    product('p5', 'Clay Mask', ['oily', 'combination'], 3),
  ];
  const ids = selectRecommendations(products, 'oily', 10).map((p) => p.id);
  assert.deepEqual(ids, ['p5', 'p1', 'p3']);
});

test('BR3: exact skin-type matches come before "all" products and limit is applied', () => {
  const products = [product('p3', 'A All', ['all'], 1), product('p1', 'Z Oily', ['oily'], 1)];
  assert.deepEqual(selectRecommendations(products, 'oily', 1).map((p) => p.id), ['p1']);
});
