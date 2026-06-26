# Distributed Systems Resilience & Microservices Split

This document explores how the architecture of the **Eco-Game** service would need to adapt if the `inventory` domain were split into a separate, independent microservice with its own database.

Currently, the service acts as a monolith using a single PostgreSQL database. This allows us to use **local ACID transactions** to guarantee that a player's currency is never deducted without granting the item, and vice versa. 

If we move to an architecture with a `Wallet Service` (managing `accounts` and `ledger`) and an `Inventory Service` (managing player `inventory`), we lose local transactions.

---

## 1. The Distributed Transaction Problem

In a split architecture, a purchase requires two operations across two systems:
1. `WalletService`: `UPDATE accounts SET balance = balance - price`
2. `InventoryService`: `INSERT INTO inventory (player_id, item_id)`

If we simply make an HTTP call from the Wallet to the Inventory:
- **Scenario A:** Wallet deducts balance, calls Inventory. Inventory call times out. Wallet rolls back? But what if Inventory actually succeeded and the timeout was just on the response? The player gets the item for free.
- **Scenario B:** Wallet deducts balance, calls Inventory. Wallet crashes immediately before receiving response. The user lost money, but we don't know if they got the item.

### Dual-Write Problem
This is the classic dual-write problem. You cannot atomically write to a database and publish to a network/message queue.

---

## 2. Proposed Architecture: The Transactional Outbox Pattern

To achieve eventual consistency and exactly-once semantics without distributed locks (Two-Phase Commit), we implement the **Transactional Outbox Pattern**.

### Step 1: The Wallet Service (Producer)
Instead of calling the Inventory service directly via HTTP, the Wallet service writes a message to an `outbox` table *in the same local transaction* as the balance deduction.

```sql
BEGIN;

-- 1. Deduct balance
UPDATE accounts SET balance = balance - 200 WHERE player_id = 'p1' AND balance >= 200;

-- 2. Write to outbox (Same DB!)
INSERT INTO outbox (
  event_id, 
  topic, 
  payload
) VALUES (
  'evt_123', 
  'item_purchased', 
  '{"playerId": "p1", "itemId": "sword"}'
);

COMMIT;
```
If the Wallet service crashes mid-flight, the transaction rolls back. Neither the deduction nor the outbox message is saved.

### Step 2: The Message Relay
A background worker (or CDC tool like Debezium) constantly tails the `outbox` table. 
When it sees a new row, it publishes the event to a message broker (e.g., Kafka, RabbitMQ, or Pub/Sub). 
Because the relay might crash, it must operate with **at-least-once** delivery semantics.

### Step 3: The Inventory Service (Consumer)
The Inventory service listens to the message broker. Since the broker guarantees at-least-once delivery, the Inventory service might receive the same `item_purchased` event multiple times.

To handle this, the Inventory service must be **Idempotent**.
It uses an `idempotency_keys` table (similar to what we built in Phase 2) keyed by the `event_id` generated in Step 1.

```sql
BEGIN;
-- Try to insert idempotency key
INSERT INTO idempotency_keys (key) VALUES ('evt_123'); -- fails if already processed

-- Grant item
INSERT INTO inventory (player_id, item_id) VALUES ('p1', 'sword');
COMMIT;
```

---

## 3. Handling Rollbacks (Saga Pattern)

What if the Wallet deducts the money and sends the `item_purchased` event, but the Inventory service rejects the grant (e.g., the player's inventory is full)?

Because the money is already gone, we must issue a **Compensating Transaction**.
1. Inventory service fails to grant the item.
2. Inventory service publishes an `item_grant_failed` event to the broker.
3. Wallet service listens for `item_grant_failed`.
4. Wallet service processes the event idempotently and refunds the player's balance, adding a ledger entry for "Purchase Refund".

---

## 4. Auditing and Anomaly Detection

In distributed systems, silent failures and race conditions can lead to currency duplication. A robust game economy requires external reconciliation.

### Event Sourcing & Data Lake
All events (`credit_issued`, `item_purchased`, `item_granted`, `refund_issued`) should be streamed to a centralized Data Lake (e.g., BigQuery, Snowflake).

### Anomaly Detection Jobs
We can run daily or hourly reconciliation jobs:
- **Balance Invariant Check:** Sum of all `credit_issued` minus `item_purchased` for a player must exactly match their current balance in the Wallet DB.
- **Dangling Purchases:** Find all `item_purchased` events older than 5 minutes that do not have a corresponding `item_granted` or `refund_issued` event. Trigger an alert.

By relying on outbox patterns, idempotent consumers, and strong audit pipelines, we can safely split the monolith while maintaining the integrity of the game's economy.
