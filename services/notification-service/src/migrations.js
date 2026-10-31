module.exports = [
  {
    version: 1,
    name: 'processed messages and notifications',
    sql: `
      -- Challenge 3D: one row per consumed message. The PRIMARY KEY makes redelivered duplicates a no-op.
      CREATE TABLE processed_messages (
        message_id   TEXT PRIMARY KEY,
        event_type   TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- order_id and user_id are ids owned by order-service.
      CREATE TABLE notifications (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id TEXT NOT NULL REFERENCES processed_messages(message_id),
        order_id   TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        channel    TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
        recipient  TEXT NOT NULL,
        subject    TEXT NOT NULL,
        body       TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('SENT')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX notifications_order_idx ON notifications (order_id);
      CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
    `,
  },
];
