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

/**
 * Helper: credit a player so they have a known balance before purchasing.
 */
async function seedBalance(playerId: string, amount: number, key: string) {
  const res = await server.inject({
    method: 'POST',
    url: `/v1/wallets/${playerId}/credit`,
    headers: { 'idempotency-key': key },
    payload: { amount, reason: 'test_seed' },
  });
  expect(res.statusCode).toBe(200);
}

describe('POST /v1/wallets/:playerId/purchase', () => {
  it('should debit balance and grant item when funds are sufficient', async () => {
    // Seed: give player 500 currency
    await seedBalance('player-1', 500, 'seed-1');

    // Purchase an item for 200
    const response = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/purchase',
      headers: { 'idempotency-key': 'purchase-1' },
      payload: { itemId: 'sword_of_fire', price: 200 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.balance).toBe(300); // 500 - 200
    expect(body.itemId).toBe('sword_of_fire');

    // Verify via GET wallet
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    const walletBody = wallet.json();
    expect(walletBody.balance).toBe(300);
    expect(walletBody.inventory).toHaveLength(1);
    expect(walletBody.inventory[0].itemId).toBe('sword_of_fire');
    expect(walletBody.inventory[0].price).toBe(200);
  });

  it('should reject purchase with 402 when funds are insufficient — no partial effect', async () => {
    // Seed: give player only 100
    await seedBalance('player-1', 100, 'seed-low');

    // Try to purchase for 500 — should fail
    const response = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/purchase',
      headers: { 'idempotency-key': 'purchase-fail' },
      payload: { itemId: 'expensive_item', price: 500 },
    });

    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('insufficient_funds');

    // Verify: balance unchanged, no item in inventory
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    const walletBody = wallet.json();
    expect(walletBody.balance).toBe(100); // unchanged
    expect(walletBody.inventory).toHaveLength(0); // no partial grant
  });

  it('should return same response and NOT double-debit on duplicate purchase key', async () => {
    await seedBalance('player-1', 500, 'seed-dup');

    const requestOptions = {
      method: 'POST' as const,
      url: '/v1/wallets/player-1/purchase',
      headers: { 'idempotency-key': 'dup-purchase' },
      payload: { itemId: 'shield', price: 150 },
    };

    // First purchase
    const first = await server.inject(requestOptions);
    expect(first.statusCode).toBe(200);
    expect(first.json().balance).toBe(350); // 500 - 150

    // Duplicate (same key) — should replay, NOT debit again
    const second = await server.inject(requestOptions);
    expect(second.statusCode).toBe(200);
    expect(second.json().balance).toBe(350); // still 350, NOT 200

    // Verify: only one item in inventory, balance is 350
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    const walletBody = wallet.json();
    expect(walletBody.balance).toBe(350);
    expect(walletBody.inventory).toHaveLength(1); // only one shield
  });
});
