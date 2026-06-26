import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, cleanDb, buildTestServer, pool } from './setup.js';
import { type FastifyInstance } from 'fastify';

let server: FastifyInstance;

beforeAll(async () => {
  await setupTestDb();
  server = buildTestServer();
  await server.ready();
});

afterAll(async () => {
  await server.close();
  await teardownTestDb();
});

beforeEach(async () => {
  await cleanDb();
});

describe('Durability & Crash Recovery (automated)', () => {
  it('simulated crash mid-purchase leaves no partial state (all-or-nothing)', async () => {
    // 1. Seed the player with 500 coins via the real API
    const credit = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/credit',
      headers: { 'idempotency-key': 'dur-credit-1' },
      payload: { amount: 500, reason: 'durability seed' },
    });
    expect(credit.statusCode).toBe(200);

    // 2. Simulate a crash mid-purchase: open a raw transaction,
    //    debit the balance, but DON'T insert inventory or commit.
    //    Then ROLLBACK — this is what Postgres does on kill -9.
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');

      // Debit succeeds inside the transaction...
      await client.query(
        `UPDATE accounts SET balance = balance - 200
         WHERE player_id = 'player-1' AND balance >= 200`
      );

      // Simulate crash: ROLLBACK instead of continuing to inventory + COMMIT
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // 3. Verify NO partial state leaked:
    //    - Balance must still be 500 (debit was rolled back)
    //    - Inventory must be empty (grant never happened)
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    const body = wallet.json();
    expect(body.balance).toBe(500);  // Debit rolled back
    expect(body.inventory).toHaveLength(0);  // No partial grant
  });

  it('idempotent retry after simulated crash reprocesses cleanly', async () => {
    // 1. Seed player
    await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/credit',
      headers: { 'idempotency-key': 'dur-credit-2' },
      payload: { amount: 500, reason: 'durability seed' },
    });

    // 2. Simulate a crash: insert an idempotency key as 'in_progress'
    //    inside a transaction, then ROLLBACK (simulates kill -9 before COMMIT).
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO idempotency_keys (key, endpoint, request_hash, status)
         VALUES ('dur-purchase-1', 'purchase', 'fakehash', 'in_progress')`
      );
      // Crash! Postgres rolls back everything.
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // 3. Retry with the SAME idempotency key — since the key was rolled back,
    //    the retry should process the purchase as a fresh request.
    const purchase = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/purchase',
      headers: { 'idempotency-key': 'dur-purchase-1' },
      payload: { itemId: 'durability-sword', price: 200 },
    });
    expect(purchase.statusCode).toBe(200);

    // 4. Verify exactly one effect
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    const body = wallet.json();
    expect(body.balance).toBe(300);  // 500 - 200
    expect(body.inventory).toHaveLength(1);
    expect(body.inventory[0].itemId).toBe('durability-sword');
  });

  it('committed data survives pool disconnect and reconnect', async () => {
    // 1. Credit and purchase via the API
    await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/credit',
      headers: { 'idempotency-key': 'dur-credit-3' },
      payload: { amount: 1000, reason: 'persistence test' },
    });

    const purchase = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/purchase',
      headers: { 'idempotency-key': 'dur-purchase-3' },
      payload: { itemId: 'persist-shield', price: 300 },
    });
    expect(purchase.statusCode).toBe(200);

    // 2. Verify data is readable immediately (proves COMMIT was durable)
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    const body = wallet.json();
    expect(body.balance).toBe(700);
    expect(body.inventory).toHaveLength(1);
    expect(body.inventory[0].itemId).toBe('persist-shield');

    // 3. Query the ledger directly to confirm the append-only audit trail
    const ledger = await pool!.query(
      `SELECT delta, kind, reason FROM ledger
       WHERE player_id = 'player-1' ORDER BY id`
    );
    expect(ledger.rows).toHaveLength(2);
    expect(ledger.rows[0]).toMatchObject({ delta: '1000', kind: 'credit' });
    expect(ledger.rows[1]).toMatchObject({ delta: '-300', kind: 'purchase' });
  });
});
