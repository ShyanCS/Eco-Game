import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, cleanDb, buildTestServer } from './setup.js';
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

async function seedBalance(playerId: string, amount: number, key: string) {
  const res = await server.inject({
    method: 'POST',
    url: `/v1/wallets/${playerId}/credit`,
    headers: { 'idempotency-key': key },
    payload: { amount, reason: 'test_seed' },
  });
  expect(res.statusCode).toBe(200);
}

describe('Concurrency: parallel purchases on the same wallet', () => {
  /**
   * REQUIRED BY THE BRIEF:
   * "seed a balance that affords only one of two purchases; fire both
   *  purchase requests concurrently with different idempotency keys;
   *  assert exactly one 200 and one 402/insufficient-funds, and the
   *  final balance matches only the winner."
   *
   * This test uses real parallel HTTP calls via Promise.all — not mocked.
   * The conditional UPDATE (balance -= price WHERE balance >= price) takes a
   * row-level lock, so the second purchase waits and re-evaluates against
   * the updated balance. Exactly one succeeds.
   */
  it('two concurrent purchases on a balance that affords only one → exactly one success', async () => {
    // Seed: 300 currency. Each purchase costs 250. Only one can succeed.
    await seedBalance('player-race', 300, 'seed-race');

    // Fire both purchases concurrently with DIFFERENT idempotency keys
    const [res1, res2] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/v1/wallets/player-race/purchase',
        headers: { 'idempotency-key': 'race-key-1' },
        payload: { itemId: 'item_a', price: 250 },
      }),
      server.inject({
        method: 'POST',
        url: '/v1/wallets/player-race/purchase',
        headers: { 'idempotency-key': 'race-key-2' },
        payload: { itemId: 'item_b', price: 250 },
      }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();

    // Exactly one 200 and one 402
    expect(statuses).toEqual([200, 402]);

    // The winner got the item, the loser didn't
    const winner = res1.statusCode === 200 ? res1.json() : res2.json();
    expect(winner.balance).toBe(50); // 300 - 250

    // Verify final state: balance is 50, exactly 1 item in inventory
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-race',
    });
    const walletBody = wallet.json();
    expect(walletBody.balance).toBe(50);
    expect(walletBody.inventory).toHaveLength(1);
  });

  /**
   * Run the race multiple times to shake out flakiness.
   * If the concurrency control is correct, every run produces
   * exactly one winner and one loser.
   */
  it('concurrent purchase race is stable across 10 iterations', async () => {
    for (let i = 0; i < 10; i++) {
      await cleanDb();
      await seedBalance('player-stress', 100, `stress-seed-${i}`);

      const [r1, r2] = await Promise.all([
        server.inject({
          method: 'POST',
          url: '/v1/wallets/player-stress/purchase',
          headers: { 'idempotency-key': `stress-a-${i}` },
          payload: { itemId: 'item_x', price: 80 },
        }),
        server.inject({
          method: 'POST',
          url: '/v1/wallets/player-stress/purchase',
          headers: { 'idempotency-key': `stress-b-${i}` },
          payload: { itemId: 'item_y', price: 80 },
        }),
      ]);

      const statuses = [r1.statusCode, r2.statusCode].sort();
      expect(statuses, `Iteration ${i} failed`).toEqual([200, 402]);

      const wallet = await server.inject({
        method: 'GET',
        url: '/v1/wallets/player-stress',
      });
      expect(wallet.json().balance, `Balance wrong at iteration ${i}`).toBe(20); // 100 - 80
      expect(wallet.json().inventory, `Inventory wrong at iteration ${i}`).toHaveLength(1);
    }
  });
});
