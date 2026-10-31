module.exports = [
  {
    version: 1,
    name: 'payments',
    sql: `
      -- order_id is owned by order-service. UNIQUE enforces BR6: at most one charge per order.
      CREATE TABLE payments (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id       TEXT NOT NULL UNIQUE,
        user_id        TEXT NOT NULL,
        amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
        status         TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'DECLINED')),
        failure_reason TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];
