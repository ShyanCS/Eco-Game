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

describe('POST /v1/wallets/:playerId/credit', () => {
  it('should create account and credit balance for a new player', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/credit',
      headers: {
        'idempotency-key': 'credit-key-1',
      },
      payload: {
        amount: 100,
        reason: 'battle_payout',
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.balance).toBe(100);
    expect(body.playerId).toBe('player-1');

    // Verify via GET wallet
    const walletResponse = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });

    expect(walletResponse.statusCode).toBe(200);
    const wallet = walletResponse.json();
    expect(wallet.balance).toBe(100);
  });
});
