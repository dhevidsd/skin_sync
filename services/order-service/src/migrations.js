module.exports = [
  {
    version: 1,
    name: 'cart, orders, idempotency keys and outbox',
    sql: `
      -- product_id values are ids owned by catalog-service (no cross-service FK).
      CREATE TABLE cart_items (
        user_id    TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 5), -- BR4 safety net
        added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, product_id)
      );

      CREATE TABLE orders (
        id             UUID PRIMARY KEY,
        user_id        TEXT NOT NULL,
        status         TEXT NOT NULL CHECK (status IN ('PENDING', 'STOCK_RESERVED', 'PAID', 'CONFIRMED', 'CANCELLED', 'FAILED')),
        total_cents    INTEGER,
        payment_id     TEXT,  -- id owned by payment-service
        failure_reason TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);

      -- name and price are a snapshot taken from catalog-service when stock is reserved.
      CREATE TABLE order_items (
        order_id         UUID NOT NULL REFERENCES orders(id),
        product_id       TEXT NOT NULL,
        product_name     TEXT,
        unit_price_cents INTEGER,
        quantity         INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 5),
        PRIMARY KEY (order_id, product_id)
      );

      CREATE TABLE order_status_history (
        id          BIGSERIAL PRIMARY KEY,
        order_id    UUID NOT NULL REFERENCES orders(id),
        from_status TEXT,
        to_status   TEXT NOT NULL,
        reason      TEXT,
        changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Challenge 2: one row per Idempotency-Key. The PRIMARY KEY makes concurrent duplicates collide.
      CREATE TABLE idempotency_keys (
        key             TEXT PRIMARY KEY,
        request_hash    TEXT NOT NULL,
        status          TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETED')),
        order_id        UUID,
        response_status INTEGER,
        response_body   TEXT, -- exact JSON text, so a replay is byte-identical (JSONB would reorder keys)
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Challenge 3D: transactional outbox. Rows are written in the same transaction as the order change.
      CREATE TABLE outbox (
        id             UUID PRIMARY KEY, -- also used as the AMQP messageId
        aggregate_id   UUID NOT NULL,
        event_type     TEXT NOT NULL,
        payload        JSONB NOT NULL,
        correlation_id TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at   TIMESTAMPTZ
      );
      CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;
    `,
  },
];
