# Challenge 1: Concurrency control (stock)

**Claim:** simultaneous orders for the same product never over-allocate its stock. With stock N and R > N
parallel orders, exactly N succeed and R - N are rejected with `409 OUT_OF_STOCK`, and the database stays
consistent.

**Mechanism** (`services/catalog-service/src/repository.js` `decrementStock`, called inside a transaction by
`service.js` `reserveStock`):

```sql
UPDATE products SET stock = stock - $qty, updated_at = now()
WHERE id = $id AND stock >= $qty
RETURNING *;
```

The check and the write are a single atomic statement. PostgreSQL row-locks the product, so a concurrent
UPDATE waits and then re-checks `stock >= $qty` against the committed value. 0 rows updated means
`409 OUT_OF_STOCK`, and the whole reservation transaction is rolled back. `CHECK (stock >= 0)` is a last line of
defence. Multi-item orders lock products in productId order, which prevents deadlocks.

**Script:** [`scripts/challenge1-concurrency.js`](../../scripts/challenge1-concurrency.js), run with
`npm run challenge1` (options `--stock 5 --requests 25`). Each run writes `run-<timestamp>.txt` here.

## Files and what they prove

| File | Section | Proves |
|---|---|---|
| [run-2026-10-31T05-31-18.txt](run-2026-10-31T05-31-18.txt) | Part A table | 25 orders fired in parallel through order-service: 5 x `201 CONFIRMED`, 20 x `409 OUT_OF_STOCK` |
| same | Part A "Final database state" | `catalog_db.products.stock = 0` (never negative), 5 RESERVED reservations for 5 units, `order_db`: 5 CONFIRMED + 20 FAILED (OUT_OF_STOCK) |
| same | Part B | **Failure case / counter-example:** the naive check-then-update endpoint accepted 25 reservations for 5 units; the final stock was 4 (lost updates, oversold by 20) |
| same | "Why a plain check-then-update fails" | explanation of the race |

## Why check-then-update fails

```
request A: SELECT stock -> 1        request B: SELECT stock -> 1
request A: 1 >= 1, OK               request B: 1 >= 1, OK
request A: UPDATE stock = 0         request B: UPDATE stock = 0      -> 2 units sold, 1 existed
```

Both requests read the same value before either writes, both pass the check in application code, and the
second write overwrites the first (lost update). Part B of the script reproduces this against
`POST /api/v1/demo/naive-reservations`, which exists only when `ENABLE_NAIVE_DEMO=true`.

## Limitations

- The row lock serialises reservations of one hot product. That is fine at this scale; very hot items would
  need stock sharding or a queue.
- Alternatives considered: `SELECT ... FOR UPDATE` (correct, but two round trips while holding the lock),
  optimistic locking with a version column (needs retries under contention, wasteful for a hot item), and
  SERIALIZABLE isolation (correct, but raises serialization failures that the caller must retry).
