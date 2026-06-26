# Durable Game Economy Service

A robust wallet and economy HTTP service for game backends. It handles currency credits, atomic purchases, and one-time reward claims with **exactly-once semantics** and **strict crash durability**.

This project implements a Node.js + Fastify service backed by PostgreSQL, designed to survive process terminations (`kill -9`) without data corruption, lost updates, or double-processing.

## Core Features

- **Exactly-Once Execution:** Utilizes `Idempotency-Key` headers and atomic database transactions to guarantee that retried requests (due to network failure or client timeouts) never result in double-credits or duplicate purchases.
- **Crash Durability:** Built on PostgreSQL's Write-Ahead Log (WAL). If the service crashes mid-transaction, no partial state is leaked. The next retry will safely pick up where it left off.
- **Atomic Purchases:** Currency deduction and inventory fulfillment happen atomically. It is impossible to lose coins without receiving the item, or to receive an item without paying.
- **Input Validation:** Hardened endpoints using Zod schema validation to prevent malformed data, excessive payload sizes (DoS protection), and numeric overflow.

---

## Getting Started

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- Node.js 22+ (only if you want to run tests locally outside of Docker)

### Running the Service

The easiest way to start the service and its database is via Docker Compose.

```bash
# Start the Postgres database and Node.js app in the background
docker compose up --build -d

# View logs
docker compose logs -f app
```

The API will be available at `http://localhost:3000`.

### Stopping the Service

```bash
docker compose down
```
*Note: A named volume (`pgdata`) is used. Data will persist across restarts. To wipe all data, run `docker compose down -v`.*

---

## API Documentation & Examples

All mutating endpoints require an `Idempotency-Key` header (string, 1-100 characters) and a `Content-Type: application/json` header.

### 1. Credit Player Wallet
Adds currency to a player's wallet.

```bash
curl -X POST http://localhost:3000/v1/wallets/player-1/credit \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: credit-tx-123" \
  -d '{"amount": 500, "reason": "daily_login"}'
```

### 2. Make a Purchase
Deducts currency and adds an item to the player's inventory atomically. Fails with `402 Payment Required` if balance is insufficient.

```bash
curl -X POST http://localhost:3000/v1/wallets/player-1/purchase \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: purchase-tx-456" \
  -d '{"itemId": "magic-sword", "price": 200}'
```

### 3. Claim Reward
Claims a one-time reward (e.g., leveling up, achieving a milestone). This route enforces uniqueness on the composite key `(rewardId, playerId)`.

```bash
curl -X POST http://localhost:3000/v1/rewards/level-10/claim \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: claim-tx-789" \
  -d '{"playerId": "player-1"}'
```

### 4. Get Player Wallet
Retrieves the player's current balance and inventory.

```bash
curl http://localhost:3000/v1/wallets/player-1
```
**Example Response:**
```json
{
  "playerId": "player-1",
  "balance": 300,
  "inventory": [
    { "itemId": "magic-sword", "acquiredAt": "2023-10-27T12:00:00.000Z" }
  ]
}
```

---

## Running Tests

This project includes a comprehensive suite of automated integration, concurrency, and durability tests using Vitest.

### Automated Tests
Run tests locally (requires Node.js):
```bash
# Install dependencies
npm install

# Run the test suite (spins up a separate test database automatically)
npm test
```

### Manual Crash Recovery Test
A shell script is provided to simulate a hard crash (`kill -9`) mid-purchase to prove WAL recovery and idempotency logic.

```bash
# Ensure the Docker stack is running first
docker compose up --build -d

# Run the crash test
bash scripts/crash-test.sh
```

---

## Documentation

- **[DESIGN.md](./DESIGN.md):** Detailed architectural decisions, data models, concurrency control, and durability strategies.
- **[RESILIENCE.md](./RESILIENCE.md):** Theoretical approach for splitting inventory into a separate microservice, addressing distributed transactions and outbox patterns.
- **[PROJECT_PLAN.md](./PROJECT_PLAN.md):** The original structured roadmap for building this service.
