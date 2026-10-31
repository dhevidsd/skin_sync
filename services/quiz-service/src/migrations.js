module.exports = [
  {
    version: 1,
    name: 'quiz results',
    sql: `
      -- user_id is an external identifier (no auth/user service in scope).
      CREATE TABLE quiz_results (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    TEXT NOT NULL,
        skin_type  TEXT NOT NULL CHECK (skin_type IN ('oily', 'dry', 'combination', 'normal', 'sensitive')),
        answers    JSONB NOT NULL,
        scores     JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX quiz_results_user_idx ON quiz_results (user_id, created_at DESC);
    `,
  },
];
