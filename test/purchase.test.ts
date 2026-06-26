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
});
