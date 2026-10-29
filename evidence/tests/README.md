# Tests

| File | Produced by | Proves |
|---|---|---|
| [UNIT_FILE](UNIT_FILE) | `npm test` | 34 unit tests across the 5 services, at least one per business rule BR1-BR6 (test names start with the rule id). No database is needed: rules are pure functions in each `src/rules.js` |
| [E2E_FILE](E2E_FILE) | `npm run e2e` | Main transaction across all 5 services, 18/18 checks: quiz (BR2) -> recommendations (BR3) -> cart (BR4) -> order CONFIRMED (BR1, BR5, BR6) -> notification delivered via RabbitMQ. **Failure cases:** cart quantity > 5 gives 422, empty cart gives 422, cancelling a CONFIRMED order gives 409, forced payment decline gives 402 with the order FAILED and stock released |

The mapping of rules to code and tests is in [docs/business-rules.md](../../docs/business-rules.md).
