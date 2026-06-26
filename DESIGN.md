# Design Document — Durable Game Economy Service

## Architecture Overview

This service is a wallet/economy HTTP backend for a game. Players can earn
currency (credits), spend it on items (purchases), and claim one-time rewards.
The service sits behind the game client and is the **authoritative source of
truth** for all balances, inventory, and reward state.

```
┌────────────┐       HTTP/JSON        ┌──────────────────┐       SQL/TCP       ┌──────────────┐
│ Game Client│ ───────────────────────►│  Fastify Server  │ ──────────────────► │ PostgreSQL   │
│            │  Idempotency-Key header │  (Node.js)       │  Transactions +    │ 16 (Docker)  │
│            │ ◄─────────────────────  │                  │  Row-level locks   │ Named volume │
└────────────┘       JSON response     └──────────────────┘                     └──────────────┘
```

### API Contract

| Method & Path | Body | Success | Effect |
|---|---|---|---|
| `POST /v1/wallets/{playerId}/credit` | `{ amount: int>0, reason: str }` | `200` | Add currency (battle payout) |
| `POST /v1/wallets/{playerId}/purchase` | `{ itemId: str, price: int>0 }` | `200` | Atomically debit + grant item |
| `POST /v1/rewards/{rewardId}/claim` | `{ playerId: str }` | `200` | Grant reward once per player |
| `GET /v1/wallets/{playerId}` | — | `200` | Read balance, inventory, rewards |

All mutating endpoints require an `Idempotency-Key` header (see below).

### Error Response Shape

All errors follow a consistent structure:
```json
{ "error": { "code": "string_code", "message": "Human-readable description" } }
```

Error codes used:
- `400` — validation failure (missing fields, bad types, negative amounts, etc.)
- `402` — insufficient funds (purchase only)
- `404` — player not found (GET wallet only)
- `409` — idempotency key conflict (reuse with different payload, or in-progress), or reward already claimed
- `501` — endpoint not yet implemented (stub routes during development)

---

## Stack Choice

**Language/Runtime:** TypeScript on Node.js with Fastify.

**Why:** The assessment grades explicit reasoning about transaction control,
isolation levels, and crash recovery. TypeScript gives us type safety at the
boundary (via `zod`) and Fastify gives us a fast, low-overhead HTTP layer.
We use the `pg` driver directly with hand-written SQL — no ORM — because an
ORM that hides `BEGIN`/`COMMIT` and lock behavior works against the thing
being graded. Explicit transaction control is the whole point.

**Validation:** `zod` schemas at the boundary on every endpoint. Reject
before any DB call — non-integers, negative/zero amounts, huge numbers
(capped at 1e9), missing fields, malformed JSON, oversized bodies.

---

## Datastore Choice

**PostgreSQL 16**, running in Docker via `docker-compose`, with a **named
volume** (`pgdata`) for the data directory so it survives container restarts
and `docker compose down/up` cycles. Only an explicit volume removal
(`docker volume rm`) wipes state.

**Why Postgres over alternatives:**

| Option | Why not |
|---|---|
| SQLite (embedded) | No client/server separation — crash of the app process risks WAL corruption under certain write patterns. No row-level locking; whole-DB locks hurt concurrency. |
| Redis | No ACID transactions. Persistence (RDB/AOF) has known data-loss windows on crash. |
| MongoDB | No multi-document ACID transactions across collections (prior to 4.0, and still limited). Harder to reason about isolation. |
| **PostgreSQL** ✓ | Real client/server ACID transactions. Row-level locking. Mature crash recovery via WAL. Forces us to reason about isolation level explicitly. |

The datastore choice is not "use Postgres because it's popular" — it's because
this exercise is fundamentally about **transactions, isolation, and durability**,
and Postgres gives us the primitives to implement and *explain* each one.

---

## Schema Design

Five tables, created by migration `0001_init.sql`:

- **`accounts`** — player balance. `CHECK (balance >= 0)` enforced at the DB
  level so a negative balance is impossible even if application logic has a bug.
- **`ledger`** — append-only record of every balance change (credit, debit,
  refund). Enables audit, reconciliation, and the double-credit detection
  scenario from RESILIENCE.md.
- **`inventory`** — items granted to players via purchases.
- **`reward_claims`** — composite primary key `(reward_id, player_id)` enforces
  claim-once at the database level, not just application logic.
- **`idempotency_keys`** — stores the key, request hash, status, and cached
  response for exactly-once processing.

---

## Idempotency Strategy (Exactly-Once Under Retries)

This is the single most important design decision.

### Mechanism

An `Idempotency-Key` HTTP header is **required** on all three mutating
endpoints. The mandated body shape has no room for a client-supplied key,
and we cannot deduplicate by content hash alone — two *legitimate* battle
payouts of the same amount and reason must NOT collapse into one credit.
A header-supplied, client-generated UUID is the only correct mechanism.

### How It Works (All Inside ONE Database Transaction)

```
1. INSERT INTO idempotency_keys (...) ON CONFLICT (key) DO NOTHING RETURNING key
2. If 0 rows returned → key already exists:
   a. status='completed' AND hash matches  → replay stored response (no re-execution)
   b. status='completed' AND hash differs  → 409 idempotency_key_reuse (client bug)
   c. status='in_progress'                 → 409 concurrent request with same key
3. If we won the insert → run business logic in the SAME transaction
   → UPDATE idempotency_keys SET status='completed', response=...
   → COMMIT
```

### Why This Is Crash-Safe

The idempotency record and the business effect (balance change, inventory
grant, etc.) are committed **atomically in one transaction**:

- **`kill -9` before COMMIT** → Postgres rolls back the entire transaction
  on restart (WAL recovery). The idempotency key is gone, the balance is
  unchanged. A retry reprocesses cleanly as if the first attempt never happened.

- **`kill -9` after COMMIT but before response reaches client** → The
  transaction is durable. A retry finds the key with `status='completed'`
  and replays the cached response. The business effect happened exactly once.

There is **no window** where the effect happened but isn't recorded, or where
it's recorded but didn't happen. This is the core guarantee.

### Key Retention

Idempotency keys are currently retained indefinitely. The `created_at` column
and index (`idx_idempotency_keys_created_at`) exist to support a future TTL
cleanup job (e.g., delete keys older than 7 days). For this exercise, indefinite
retention is simpler and safer — a client retrying after hours still gets the
correct replayed response.

**Trade-off:** Indefinite retention means the table grows. In production, a
background job would periodically purge old keys. The retention window must be
longer than the maximum realistic retry delay.

---

## Isolation Level and Concurrency

**Isolation level: READ COMMITTED** (PostgreSQL's default).

We deliberately do **not** use SERIALIZABLE, because the conditional UPDATE
pattern makes it unnecessary:

```sql
UPDATE accounts SET balance = balance - $price
WHERE player_id = $1 AND balance >= $price
RETURNING balance;
```

This statement takes a **row-level write lock** on the account row for the
duration of the transaction. Two concurrent purchases on the same wallet
serialize on that row: the second waits, then re-evaluates `balance >= price`
against the post-first-purchase balance.

**Why not SERIALIZABLE?** SERIALIZABLE would add serialization-failure retries
(`40001` errors) with no correctness benefit — the conditional UPDATE is already
immune to the lost-update problem. Adding SERIALIZABLE would only introduce
retry-on-conflict complexity for zero additional safety.

**Why not SELECT ... FOR UPDATE?** The conditional UPDATE achieves the same
row lock implicitly. A separate `SELECT ... FOR UPDATE` followed by an
application-side balance check would be a read-then-write anti-pattern and
more error-prone.

---

## Purchase Atomicity

A purchase must **debit the balance and grant the item together, or do
neither.** This is enforced by executing all three operations inside a single
database transaction (shared with the idempotency record):

1. **Conditional debit:** `UPDATE accounts SET balance = balance - $price WHERE player_id = $1 AND balance >= $price RETURNING balance`
2. **Inventory grant:** `INSERT INTO inventory (player_id, item_id, price) VALUES (...)`
3. **Ledger entry:** `INSERT INTO ledger (player_id, delta, kind, reason) VALUES (...)`

If step 1 returns 0 rows (insufficient funds), we skip steps 2-3 and return
a `402 insufficient_funds` error. The idempotency record still stores this
rejection — so a retry of a failed purchase replays the 402 without re-checking
the balance (which may have changed since).

**Why 402?** We chose HTTP 402 (Payment Required) for insufficient-funds
rejections because it has the clearest semantic fit: the request is valid
but cannot be fulfilled because the player doesn't have enough currency.
This is a deliberate choice — alternatives like 400 (malformed request) or
409 (conflict) don't describe the failure as precisely.

**No partial state is possible:**
- If the process crashes before COMMIT → Postgres rolls back all three
  operations (debit, grant, and ledger) together.
- If the process crashes after COMMIT → all three are durable, and the
  idempotency record prevents re-execution.

---

## Reward Claiming (Claim-Once)

A reward can only be claimed once per player. This is enforced directly at the database level by the `reward_claims` table using a composite primary key:

```sql
CREATE TABLE IF NOT EXISTS reward_claims (
  reward_id  TEXT NOT NULL,
  player_id  TEXT NOT NULL REFERENCES accounts(player_id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reward_id, player_id)
);
```

### Flow and Concurrency Safety

1. **Existence check:** We verify if the player exists. If not, return `404 player_not_found`.
2. **Claim enforcement:** We attempt to record the claim in `reward_claims` using the `ON CONFLICT DO NOTHING` clause:
   ```sql
   INSERT INTO reward_claims (reward_id, player_id)
   VALUES ($1, $2)
   ON CONFLICT (reward_id, player_id) DO NOTHING
   RETURNING reward_id;
   ```
3. **Collision handling:**
   - If the insert returns a row, the claim succeeds, and we return `200`.
   - If the insert returns no rows, the reward has already been claimed by this player. We cleanly return `409 already_claimed`.

### Why `ON CONFLICT DO NOTHING` is Used
By using `ON CONFLICT DO NOTHING` rather than letting the constraint throw a unique violation exception, we avoid aborting the active Postgres transaction. This ensures the idempotency middleware can cleanly commit and save the `409 already_claimed` response so that future retries of the duplicate claim receive the stored response.

---

*This document is updated incrementally as decisions are made and implemented.*
