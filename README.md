# SkinSync

SkinSync is a microservices application. A user takes a skin-type quiz, gets product recommendations for
their skin type, adds products to a cart and places an order. Placing an order reserves stock, charges a
(mock) payment, confirms the order and sends a (mock) email notification through RabbitMQ.

Built for *Scalable Services (SEZG583), Assignment 1*.
Authentication, UI and real payment integration are out of scope: callers pass a `userId`.

| Service | Port | Responsibility (one sentence) | Database |
|---|---|---|---|
| catalog-service | 3001 | Owns products, skin-type tags, prices and **stock** (the contended resource), and reserves/releases stock per order. | catalog_db |
| quiz-service | 3002 | Scores quiz answers to one skin type, stores the result per user and recommends products by calling catalog-service. | quiz_db |
| order-service | 3003 | Manages carts and orchestrates order placement (reserve -> pay -> confirm -> publish event). | order_db |
| payment-service | 3004 | Mock payment gateway with configurable latency and failures; charges at most once per order. | payment_db |
| notification-service | 3005 | Consumes `order.confirmed` from RabbitMQ and stores the (mock) emails it "sent". | notification_db |

## Team

| Member | BITS ID | Owns |
|---|---|---|
| DHEVI SHREE D S (lead) | 2025TM93120 | order-service, notification-service, root tooling, Challenges 2 and 3D, architecture and OpenAPI docs |
| RUCHI GUPTA | 2025TM93067 | catalog-service, seed data, Challenge 1 |
| MODI FREYA MANISH | 2025TM93084 | quiz-service, payment-service, end-to-end test |

More detail:
- [docs/architecture.md](docs/architecture.md): component diagram, sequence diagrams (happy and failure path), state machine, ER diagrams, data ownership
- [docs/business-rules.md](docs/business-rules.md): BR1-BR6 mapped to code and tests
- [docs/openapi/](docs/openapi/): OpenAPI 3 spec of every service (also served live at `http://localhost:<port>/docs`)
- [evidence/](evidence/): output of the tests and challenge scripts

## Repository layout

```
README.md
package.json            convenience scripts (install all, start all, test all, challenges)
docs/                   architecture, business rules, OpenAPI copies
services/<name>/        src/ (routes -> service -> repository, rules.js), tests/, openapi.yaml, .env.example, package.json
scripts/                db.js (dev Postgres), svc.js (start/stop services), seed, e2e, challenge scripts
evidence/               challenge-1-concurrency/, challenge-2-idempotency/, challenge-3d-events/, tests/
```

Inside each service: `routes.js` (HTTP + validation) -> `service.js` (business logic) -> `repository.js` (all SQL).
Business rules are pure functions in `rules.js` so they can be unit-tested without a database.

## Prerequisites

- **Node.js 20+** and npm (developed on Node 20.17, also tested on Node 24.22 LTS; WSL Ubuntu). No other runtime needed.
- **PostgreSQL**: none to install. `npm run db:start` runs a local PostgreSQL from the `embedded-postgres`
  npm package (dev only). Any PostgreSQL works: just point each service's `DATABASE_URL` at it.
- **RabbitMQ** on `amqp://guest:guest@localhost:5672` (only needed for the notification flow and Challenge 3D).
  On Ubuntu/WSL: `sudo apt-get install -y rabbitmq-server && sudo service rabbitmq-server start`.
  Services start and serve HTTP without it, report `DEGRADED` on `/health`, and connect automatically when it comes up.
- **psql** (optional, to inspect a database): `sudo apt-get install -y postgresql-client`, then e.g.
  `psql postgres://catalog_user:catalog_pass@localhost:5432/catalog_db -c "SELECT id, stock FROM products"`.

## Quick start

```bash
npm install            # root dev tools: embedded-postgres, pg, amqplib (used by scripts only)
npm run install:all    # npm install in every service + create services/*/.env from .env.example
npm run db:start       # start PostgreSQL on :5432, create one database + one user per service
npm run start:all      # start all 5 services in the background (logs in .data/logs/<service>.log)
npm run seed           # load 16 skincare products into catalog-service
npm run status         # health of every service
```

Then run the tests and scripts:

```bash
npm test               # unit tests of all services (BR1-BR6)          -> evidence/tests/
npm run e2e            # end-to-end main flow + failure case            -> evidence/tests/
npm run challenge1     # concurrency: 25 parallel orders, stock 5       -> evidence/challenge-1-concurrency/
npm run challenge2     # idempotency: repeat, concurrent, mismatch      -> evidence/challenge-2-idempotency/
npm run challenge3d    # events: duplicates + consumer catch-up         -> evidence/challenge-3d-events/
```

Stop everything with `npm run stop:all` and `npm run db:stop`. To start from an empty database, stop
both and delete the `.data/` folder.

### Running one service on its own

Each service is an independent Node.js app with its own `package.json` and `.env`:

```bash
cd services/order-service
npm install
cp .env.example .env   # adjust if needed
npm start              # JSON logs on stdout
```

Or, with the helper: `npm run start:service -- order-service`, `npm run stop:service -- order-service`,
`npm run restart:service -- order-service`.

Each service runs its own schema migrations on startup (`src/migrations.js`, guarded by an advisory lock).

## Configuration (environment variables)

All configuration comes from environment variables; `.env` files are only a local convenience (loaded with
`dotenv`, ignored by git). Required variables make the service exit at startup if missing.

| Variable | Services | Example / default | Purpose |
|---|---|---|---|
| `PORT` | all | 3001..3005 | HTTP port (required) |
| `DATABASE_URL` | all | `postgres://catalog_user:catalog_pass@localhost:5432/catalog_db` | own database (required) |
| `LOG_LEVEL` | all | `info` | debug / info / warn / error |
| `CATALOG_SERVICE_URL` | quiz, order | `http://localhost:3001` | catalog base URL (required) |
| `PAYMENT_SERVICE_URL` | order | `http://localhost:3004` | payment base URL (required) |
| `RABBITMQ_URL` | order, notification | `amqp://guest:guest@localhost:5672` | broker (required) |
| `HTTP_TIMEOUT_MS` | quiz, order | 2000 | timeout for calls to catalog |
| `PAYMENT_TIMEOUT_MS` / `PAYMENT_MAX_ATTEMPTS` / `PAYMENT_RETRY_BASE_MS` | order | 3000 / 3 / 200 | payment call timeout, retries, backoff base |
| `IDEMPOTENCY_WAIT_MS` | order | 5000 | how long a duplicate waits for the first request |
| `EVENTS_EXCHANGE` / `NOTIFICATION_QUEUE` | order, notification | `skinsync.events` / `notification.order-confirmed` | RabbitMQ topology |
| `OUTBOX_POLL_INTERVAL_MS` | order | 1000 | outbox relay interval |
| `BROKER_RECONNECT_MS` | order, notification | 5000 | reconnect delay when the broker is down |
| `CONSUMER_PREFETCH` / `EMAIL_LATENCY_MS` | notification | 10 / 100 | consumer concurrency, mock email delay |
| `PAYMENT_LATENCY_MS` / `PAYMENT_FAILURE_RATE` | payment | 200 / 0 | mock gateway latency and decline probability (0..1) |
| `ALLOW_SIMULATION_HEADER` | payment | `true` | honour the `X-Payment-Simulate` demo header |
| `ENABLE_NAIVE_DEMO` / `NAIVE_DEMO_DELAY_MS` | catalog | `true` / 50 | expose the unsafe check-then-update endpoint for Challenge 1 |

The scripts in `scripts/` use `CATALOG_URL`, `QUIZ_URL`, `ORDER_URL`, `PAYMENT_URL`, `NOTIFICATION_URL`,
`*_DATABASE_URL` and `RABBITMQ_URL`, defaulting to the local ports above.

## API overview

All business endpoints are versioned under `/api/v1`. Every service also has `GET /health`, `GET /docs`
(Swagger UI) and `GET /openapi.yaml`.

| Service | Method and path | Notes |
|---|---|---|
| catalog | `GET /api/v1/products?skinType=&inStock=&category=` | `skinType` also matches products tagged `all` |
| catalog | `GET /api/v1/products/{id}`, `PUT /api/v1/products/{id}` | PUT = create/replace (seed, restock) |
| catalog | `POST /api/v1/reservations`, `GET /api/v1/reservations/{orderId}`, `POST /api/v1/reservations/{orderId}/release` | idempotent per orderId |
| quiz | `GET /api/v1/quiz/questions`, `POST /api/v1/quiz/submissions` | |
| quiz | `GET /api/v1/users/{userId}/skin-profile`, `GET /api/v1/users/{userId}/recommendations?limit=` | |
| order | `GET /api/v1/carts/{userId}`, `POST /api/v1/carts/{userId}/items`, `PUT/DELETE /api/v1/carts/{userId}/items/{productId}` | |
| order | `POST /api/v1/orders` (header `Idempotency-Key` required), `GET /api/v1/orders?userId=`, `GET /api/v1/orders/{id}`, `POST /api/v1/orders/{id}/cancel` | |
| payment | `POST /api/v1/payments`, `GET /api/v1/payments?orderId=`, `GET /api/v1/payments/{id}` | |
| notification | `GET /api/v1/notifications?userId=&orderId=`, `GET /api/v1/notifications/{id}` | |

Error format, identical in all services:

```json
{ "error": { "code": "OUT_OF_STOCK", "message": "Not enough stock for product p-001",
             "details": { "productId": "p-001", "requested": 2, "available": 1 },
             "correlationId": "4f0c..." } }
```

### Try it with curl

```bash
curl -s -X POST localhost:3002/api/v1/quiz/submissions -H 'Content-Type: application/json' \
  -d '{"userId":"alice","answers":[{"questionId":"q1","optionId":"b"},{"questionId":"q2","optionId":"a"},{"questionId":"q3","optionId":"c"},{"questionId":"q4","optionId":"a"},{"questionId":"q5","optionId":"c"}]}'
curl -s localhost:3002/api/v1/users/alice/recommendations
curl -s -X POST localhost:3003/api/v1/carts/alice/items -H 'Content-Type: application/json' -d '{"productId":"p-004","quantity":2}'
curl -s -X POST localhost:3003/api/v1/orders -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: alice-order-0001' -H 'X-Correlation-Id: demo-1' -d '{"userId":"alice"}'
curl -s "localhost:3005/api/v1/notifications?userId=alice"
```

Demo controls: send `X-Payment-Simulate: fail` (decline), `error` (503, triggers retries), `delay=3000`
(slow gateway) or `success` on `POST /api/v1/orders`. order-service forwards it to payment-service.

## Engineering challenges (summary)

| Challenge | Mechanism | Script |
|---|---|---|
| 1. Concurrency | `UPDATE products SET stock = stock - q WHERE id = ? AND stock >= q` in a transaction, `CHECK (stock >= 0)`, rows locked in productId order | `npm run challenge1` |
| 2. Idempotency | `idempotency_keys` row (key PK, SHA-256 fingerprint, IN_PROGRESS -> COMPLETED + stored response) inserted **before** executing; payments UNIQUE per orderId | `npm run challenge2` |
| 3D. Event-driven | transactional outbox + relay (publisher confirms), durable queue, persistent messages, manual ack, `messageId`; consumer dedupes with `processed_messages` PK | `npm run challenge3d` |

Each evidence folder has a README that links every output file to the claim it supports.

## Troubleshooting

- `Missing required environment variable ...`: run `npm run install:all` (creates `.env` files) or export the variable.
- `database not reachable yet`: run `npm run db:start`; the services retry for ~30 s on startup.
- Port 5432 already used by another PostgreSQL: `PGPORT=5433 npm run db:start` and change the port in each `services/*/.env`.
- `/health` shows `"broker":"DOWN"`: RabbitMQ is not running or `RABBITMQ_URL` is wrong. Orders still work; events are sent once it is up.
