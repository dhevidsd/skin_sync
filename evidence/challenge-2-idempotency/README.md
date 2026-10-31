# Challenge 2: Idempotency

**Claim:** repeating `POST /api/v1/orders` with the same `Idempotency-Key` returns the same result and has no
duplicate effect (no second order, reservation or charge). This holds for sequential repeats **and** for
identical requests arriving at the same moment. The same key with a different payload is rejected with 422.

**Mechanism** (`services/order-service/src/order.service.js` `placeOrder`, `repository.js`):

1. Fingerprint = SHA-256 of `POST /api/v1/orders` + canonical JSON body (`rules.requestFingerprint`).
2. **Before** doing any work: `INSERT INTO idempotency_keys (key, request_hash, status) VALUES (..., 'IN_PROGRESS') ON CONFLICT (key) DO NOTHING`.
   The primary key guarantees only one request inserts the row. A simultaneous duplicate waits on the index
   and then gets "0 rows inserted".
3. The winner executes the order and stores `status = COMPLETED`, the HTTP status and the exact response body.
   Failures (402, 409...) are stored as well, so a key's outcome is final.
4. A loser compares fingerprints (`rules.resolveExistingKey`): different payload means `422 IDEMPOTENCY_KEY_REUSED`;
   COMPLETED means the stored response is replayed with `Idempotent-Replayed: true`; IN_PROGRESS means it polls
   for up to `IDEMPOTENCY_WAIT_MS` and then replays (or returns `409 REQUEST_IN_PROGRESS`).
5. Second layer: payment-service is idempotent per `orderId` (`payments.order_id UNIQUE` +
   `INSERT ... ON CONFLICT DO NOTHING`). A retried charge returns the original payment, and a different amount
   for the same order returns `422 IDEMPOTENCY_MISMATCH`. This is what makes order-service's payment retries safe.

**Script:** [`scripts/challenge2-idempotency.js`](../../scripts/challenge2-idempotency.js), run with `npm run challenge2`.

## Files and what they prove

| File | Section | Proves |
|---|---|---|
| [run-2026-10-31T05-31-19.txt](run-2026-10-31T05-31-19.txt) | 1. Sequential repeat | first call `201, Idempotent-Replayed: false`; 2nd and 3rd calls `201, Idempotent-Replayed: true` with byte-identical bodies |
| same | 2. Same key, different payload | **failure case:** `422 IDEMPOTENCY_KEY_REUSED` |
| same | 3. Ten identical requests at the same moment | all 10 return 201 with the same orderId; exactly 1 executed, 9 replays (payment delayed 1 s so they overlap) |
| same | 4. payment-service | charging the same order again returns the original payment (200); a different amount gets 422 |
| same | Database state | `order_db.orders`: one order per user; `idempotency_keys`: one COMPLETED row per key with its SHA-256; `payment_db.payments`: one payment per order; `catalog_db.reservations`: one per order |
| same | Service logs | order-service lines `idempotency key claimed` (once) and `idempotent replay: returning stored response` (for each repeat), payment-service `duplicate charge request` |

## Limitations

- If the process crashes after claiming a key and before completing it, the key stays IN_PROGRESS and repeats
  get `409 REQUEST_IN_PROGRESS`. A production system would add a lease/expiry on IN_PROGRESS rows plus a
  recovery job.
- Keys are never deleted. A TTL clean-up job (e.g. 24 h) would be needed in production.
- Two **different** keys for the same cart are treated as two intended orders (by design, that is the client's choice).
