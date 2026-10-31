// Data access for quiz-service. Only this module contains SQL.
const { pool } = require('./db');

function toResult(row) {
  return {
    id: row.id,
    userId: row.user_id,
    skinType: row.skin_type,
    scores: row.scores,
    answers: row.answers,
    createdAt: row.created_at,
  };
}

async function insertResult({ userId, skinType, answers, scores }) {
  const { rows } = await pool.query(
    'INSERT INTO quiz_results (user_id, skin_type, answers, scores) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, skinType, JSON.stringify(answers), JSON.stringify(scores)],
  );
  return toResult(rows[0]);
}

async function findLatestByUser(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM quiz_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId],
  );
  return rows[0] ? toResult(rows[0]) : null;
}

module.exports = { insertResult, findLatestByUser };
