// Quiz business rules. Pure functions only: unit-tested without a database.
const { AppError } = require('./errors');

const SKIN_TYPES = ['oily', 'dry', 'combination', 'normal', 'sensitive'];

// Used only when two skin types have the same score. Sensitive wins first because
// recommending gentle products is the safest choice.
const TIE_BREAK_ORDER = ['sensitive', 'combination', 'oily', 'dry', 'normal'];

// Each option adds points to one or more skin types.
const QUESTIONS = [
  {
    id: 'q1',
    text: 'A few hours after washing your face, how does your skin feel?',
    options: [
      { id: 'a', text: 'Tight, rough or flaky', points: { dry: 3 } },
      { id: 'b', text: 'Shiny and greasy all over', points: { oily: 3 } },
      { id: 'c', text: 'Shiny on forehead and nose, normal or dry on cheeks', points: { combination: 3 } },
      { id: 'd', text: 'Comfortable, neither oily nor dry', points: { normal: 3 } },
      { id: 'e', text: 'Itchy, red or stinging', points: { sensitive: 3 } },
    ],
  },
  {
    id: 'q2',
    text: 'How does your face look by midday?',
    options: [
      { id: 'a', text: 'Shiny all over', points: { oily: 2 } },
      { id: 'b', text: 'Shiny only in the T-zone', points: { combination: 2 } },
      { id: 'c', text: 'Matte and comfortable', points: { normal: 2 } },
      { id: 'd', text: 'Dull, with dry patches', points: { dry: 2 } },
    ],
  },
  {
    id: 'q3',
    text: 'How does your skin usually react to new products?',
    options: [
      { id: 'a', text: 'Redness, burning or breakouts', points: { sensitive: 3 } },
      { id: 'b', text: 'Occasional mild irritation', points: { sensitive: 1 } },
      { id: 'c', text: 'It rarely reacts', points: { normal: 1 } },
    ],
  },
  {
    id: 'q4',
    text: 'How visible are your pores?',
    options: [
      { id: 'a', text: 'Large and visible all over', points: { oily: 2 } },
      { id: 'b', text: 'Large on nose and forehead only', points: { combination: 2 } },
      { id: 'c', text: 'Small, barely visible', points: { dry: 1, normal: 1 } },
    ],
  },
  {
    id: 'q5',
    text: 'How often do you notice flaky or rough patches?',
    options: [
      { id: 'a', text: 'Often', points: { dry: 2 } },
      { id: 'b', text: 'Only on my cheeks', points: { combination: 1, dry: 1 } },
      { id: 'c', text: 'Rarely or never', points: { normal: 1, oily: 1 } },
      { id: 'd', text: 'After using certain products', points: { sensitive: 2 } },
    ],
  },
];

function invalidAnswers(code, message, details) {
  return new AppError(422, code, message, details);
}

// BR2: every question must be answered exactly once with a valid option, and the answers
// map deterministically to exactly one skin type (highest score, ties broken by TIE_BREAK_ORDER).
function scoreAnswers(answers) {
  const seen = new Set();
  for (const answer of answers) {
    const question = QUESTIONS.find((q) => q.id === answer.questionId);
    if (!question) throw invalidAnswers('UNKNOWN_QUESTION', `Unknown question ${answer.questionId}`, { questionId: answer.questionId });
    if (seen.has(answer.questionId)) throw invalidAnswers('DUPLICATE_ANSWER', `Question ${answer.questionId} answered more than once`, { questionId: answer.questionId });
    if (!question.options.some((o) => o.id === answer.optionId)) {
      throw invalidAnswers('INVALID_OPTION', `Option ${answer.optionId} is not valid for ${answer.questionId}`, answer);
    }
    seen.add(answer.questionId);
  }
  const missing = QUESTIONS.filter((q) => !seen.has(q.id)).map((q) => q.id);
  if (missing.length > 0) throw invalidAnswers('INCOMPLETE_QUIZ', 'Every question must be answered', { missing });

  const scores = Object.fromEntries(SKIN_TYPES.map((t) => [t, 0]));
  for (const answer of answers) {
    const option = QUESTIONS.find((q) => q.id === answer.questionId).options.find((o) => o.id === answer.optionId);
    for (const [type, points] of Object.entries(option.points)) scores[type] += points;
  }
  const best = Math.max(...Object.values(scores));
  const skinType = TIE_BREAK_ORDER.find((t) => scores[t] === best);
  return { skinType, scores };
}

// BR3: recommend only in-stock products tagged for this skin type or tagged "all".
// Products made for the exact skin type are listed before general ("all") products.
function selectRecommendations(products, skinType, limit) {
  return products
    .filter((p) => p.stock > 0 && (p.skinTypes.includes(skinType) || p.skinTypes.includes('all')))
    .sort((a, b) => Number(b.skinTypes.includes(skinType)) - Number(a.skinTypes.includes(skinType)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Questions as shown to the user (scoring points stay internal).
function publicQuestions() {
  return QUESTIONS.map((q) => ({ id: q.id, text: q.text, options: q.options.map((o) => ({ id: o.id, text: o.text })) }));
}

module.exports = { SKIN_TYPES, QUESTIONS, scoreAnswers, selectRecommendations, publicQuestions };
