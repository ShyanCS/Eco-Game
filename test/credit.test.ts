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

  it('should return same response and NOT double balance on duplicate idempotency key', async () => {
    const requestOptions = {
      method: 'POST' as const,
      url: '/v1/wallets/player-1/credit',
      headers: {
        'idempotency-key': 'dup-key-1',
      },
      payload: {
        amount: 50,
        reason: 'battle_payout',
      },
    };

    // First request
    const first = await server.inject(requestOptions);
    expect(first.statusCode).toBe(200);
    expect(first.json().balance).toBe(50);

    // Duplicate request (same key, same body)
    const second = await server.inject(requestOptions);
    expect(second.statusCode).toBe(200);
    expect(second.json().balance).toBe(50); // NOT 100

    // Verify balance via GET — must be 50, not 100
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    expect(wallet.json().balance).toBe(50);
  });

  it('should apply both credits when using different idempotency keys', async () => {
    // First credit
    const first = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/credit',
      headers: { 'idempotency-key': 'key-a' },
      payload: { amount: 30, reason: 'battle_1' },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().balance).toBe(30);

    // Second credit (different key, different reason)
    const second = await server.inject({
      method: 'POST',
      url: '/v1/wallets/player-1/credit',
      headers: { 'idempotency-key': 'key-b' },
      payload: { amount: 70, reason: 'battle_2' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().balance).toBe(100); // 30 + 70

    // Verify
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    expect(wallet.json().balance).toBe(100);
  });
});
