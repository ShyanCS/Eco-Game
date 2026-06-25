-- Migration 0001: Initial schema
-- Creates the core tables for the wallet/economy service.

-- Player accounts with a balance that can never go negative
CREATE TABLE IF NOT EXISTS accounts (
  player_id TEXT PRIMARY KEY,
  balance   BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0)
);

-- Append-only ledger for auditability (every balance change is recorded)
CREATE TABLE IF NOT EXISTS ledger (
  id         BIGSERIAL PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES accounts(player_id),
  delta      BIGINT NOT NULL,
  kind       TEXT NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Player inventory (items granted via purchases)
CREATE TABLE IF NOT EXISTS inventory (
  id         BIGSERIAL PRIMARY KEY,
  player_id  TEXT NOT NULL REFERENCES accounts(player_id),
  item_id    TEXT NOT NULL,
  price      BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time reward claims (composite PK enforces claim-once at DB level)
CREATE TABLE IF NOT EXISTS reward_claims (
  reward_id  TEXT NOT NULL,
  player_id  TEXT NOT NULL REFERENCES accounts(player_id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reward_id, player_id)
);

-- Idempotency keys for exactly-once request processing
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key             TEXT PRIMARY KEY,
  endpoint        TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'in_progress',
  response_status INT,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for cleanup of old idempotency keys (future TTL job)
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);

-- Index for ledger queries by player
CREATE INDEX IF NOT EXISTS idx_ledger_player_id ON ledger(player_id);

-- Index for inventory queries by player
CREATE INDEX IF NOT EXISTS idx_inventory_player_id ON inventory(player_id);
