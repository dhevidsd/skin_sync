# Business rules and traceability

Each rule lives in the service's `src/rules.js` (pure functions, no I/O) and is unit-tested in
`tests/rules.test.js`, which needs no database. Rules that must hold under concurrency are also enforced
by the database, and the challenge scripts check that part.

| Rule | Statement | Code | Unit test | Also enforced / shown by |
|---|---|---|---|---|
| **BR1** | Stock can never go below zero. An order can only reserve quantities that are available. | [catalog rules.js](../services/catalog-service/src/rules.js) `canReserve`, `normaliseReservationItems`; atomic SQL in [repository.js](../services/catalog-service/src/repository.js) `decrementStock` | [catalog tests](../services/catalog-service/tests/rules.test.js) "BR1: ..." | `CHECK (stock >= 0)`; `scripts/challenge1-concurrency.js`; `scripts/e2e.js` |
| **BR2** | Quiz answers map deterministically to exactly one skin type. Every question must be answered. | [quiz rules.js](../services/quiz-service/src/rules.js) `scoreAnswers`, `TIE_BREAK_ORDER` | [quiz tests](../services/quiz-service/tests/rules.test.js) "BR2: ..." | `scripts/e2e.js` (422 INCOMPLETE_QUIZ via API) |
| **BR3** | Recommendations only include in-stock products tagged for the user's skin type, or tagged "all". | [quiz rules.js](../services/quiz-service/src/rules.js) `selectRecommendations` | [quiz tests](../services/quiz-service/tests/rules.test.js) "BR3: ..." | `scripts/e2e.js`; seed product p-015 has stock 0 and is never recommended |
| **BR4** | Cart quantity per item is 1-5. An order cannot be placed with an empty cart. | [order rules.js](../services/order-service/src/rules.js) `assertCartQuantity`, `mergedQuantity`, `assertCartNotEmpty` | [order tests](../services/order-service/tests/rules.test.js) "BR4: ..." | `CHECK (quantity BETWEEN 1 AND 5)`; `scripts/e2e.js` |
| **BR5** | Order state transitions must follow the state machine. Illegal transitions are rejected with 409. | [order rules.js](../services/order-service/src/rules.js) `TRANSITIONS`, `assertTransition`; compare-and-set in [repository.js](../services/order-service/src/repository.js) `updateStatus` | [order tests](../services/order-service/tests/rules.test.js) "BR5: ..." | `order_status_history` table; `scripts/e2e.js` (cancel CONFIRMED -> 409) |
| **BR6** | A payment is charged at most once per order. Order placement is idempotent per Idempotency-Key. | [order rules.js](../services/order-service/src/rules.js) `requestFingerprint`, `resolveExistingKey`; [payment rules.js](../services/payment-service/src/rules.js) `assertSameCharge` | [order tests](../services/order-service/tests/rules.test.js) and [payment tests](../services/payment-service/tests/rules.test.js) "BR6: ..." | `idempotency_keys` PK, `payments.order_id` UNIQUE; `scripts/challenge2-idempotency.js` |

Run all unit tests with `npm test` (from the repository root). The output is saved to `evidence/tests/`.
