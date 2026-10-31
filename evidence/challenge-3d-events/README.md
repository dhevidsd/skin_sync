# Challenge 3D: Event-driven flow (RabbitMQ)

**Claim:** `order.confirmed` events reach notification-service reliably. A duplicate delivery of the same
message is processed only once. While notification-service is stopped, orders still succeed, and after a
restart it catches up on the backlog.

**Mechanism**

| Concern | Where | How |
|---|---|---|
| Event not lost / not sent for an uncommitted order | `order-service/src/order.service.js` (step 3) | **Transactional outbox**: `PAID -> CONFIRMED` and `INSERT INTO outbox` are in the same DB transaction |
| Publishing | `order-service/src/outbox-relay.js`, `messaging.js` | relay polls `outbox WHERE published_at IS NULL ... FOR UPDATE SKIP LOCKED`, publishes on a **confirm channel**, then marks the row sent (at-least-once) |
| Durability | both services | topic exchange `skinsync.events` (durable), queue `notification.order-confirmed` (durable), messages `persistent: true` |
| Identity | relay | AMQP `messageId` = outbox row id; `x-correlation-id` header carries the request's correlation id |
| Duplicates | `notification-service/src/service.js`, `repository.js` | `INSERT INTO processed_messages (message_id) ... ON CONFLICT DO NOTHING` in the same transaction as the notification insert; 0 rows means a duplicate, which is acked and skipped |
| Consumer failures | `notification-service/src/consumer.js` | manual `ack` only after commit; DB errors cause `nack(requeue)`; malformed messages are logged and dropped |
| Broker outages | `messaging.js`, `consumer.js` | HTTP keeps working, `/health` shows `DEGRADED`, reconnect every `BROKER_RECONNECT_MS`; events wait in the outbox |

**Script:** [`scripts/challenge3d-events.js`](../../scripts/challenge3d-events.js), run with `npm run challenge3d`.
It needs RabbitMQ and services started with `npm run start:all`, because it stops and starts notification-service itself.

## Files and what they prove

| File | Section | Proves |
|---|---|---|
| [run-2026-10-31T05-31-21.txt](run-2026-10-31T05-31-21.txt) | Preconditions | RabbitMQ reachable; order-service and notification-service `/health` show `broker: UP` |
| same | (a) Duplicate delivery | the same message (same messageId) was delivered 3 more times: twice re-published straight to the exchange, and once re-sent by the relay after `published_at` was reset to simulate a crash between publish and mark. Result: 1 notification, 1 `processed_messages` row, 3 `duplicate message ignored` log lines |
| same | (b) Consumer down | **failure case:** notification-service stopped, 3 orders still `CONFIRMED`, queue depth 0 -> 3 |
| same | (b) after restart | backlog consumed about 1 s after restart: one notification per order, queue drained to 0 |

## Limitations

- At-least-once delivery: the mock email is "sent" inside the consumer transaction. If the commit failed
  after a real provider accepted the email, the redelivery would send it again. Exactly-once towards an
  external system needs an idempotency key at the provider.
- Malformed messages are dropped after logging. A dead-letter queue is future work.
- The relay polls every second (latency up to ~1 s). Logical decoding / CDC (e.g. Debezium) would remove polling.
- order-service declares the consumer's queue so that events are kept even if notification-service has never
  run. In production that topology would be owned by infrastructure (definitions file / Kubernetes operator).
