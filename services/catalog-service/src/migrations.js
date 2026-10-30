module.exports = [
  {
    version: 1,
    name: 'products and stock reservations',
    sql: `
      CREATE TABLE products (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        brand       TEXT NOT NULL,
        category    TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price_cents INTEGER NOT NULL CHECK (price_cents > 0),
        skin_types  TEXT[] NOT NULL CHECK (cardinality(skin_types) > 0),
        stock       INTEGER NOT NULL CHECK (stock >= 0), -- BR1 safety net at the database level
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX products_skin_types_idx ON products USING GIN (skin_types);

      -- order_id is the id of an order owned by order-service (no cross-service FK).
      CREATE TABLE reservations (
        order_id   TEXT PRIMARY KEY,
        status     TEXT NOT NULL CHECK (status IN ('RESERVED', 'RELEASED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE reservation_items (
        order_id         TEXT NOT NULL REFERENCES reservations(order_id),
        product_id       TEXT NOT NULL REFERENCES products(id),
        quantity         INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_cents INTEGER NOT NULL,
        PRIMARY KEY (order_id, product_id)
      );
    `,
  },
];
