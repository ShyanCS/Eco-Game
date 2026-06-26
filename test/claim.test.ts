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
 * Helper: create a player account so claim can reference them.
 */
async function seedPlayer(playerId: string) {
  await server.inject({
    method: 'POST',
    url: `/v1/wallets/${playerId}/credit`,
    headers: { 'idempotency-key': `seed-${playerId}` },
    payload: { amount: 0, reason: 'account_creation' },
  });
}

describe('POST /v1/rewards/:rewardId/claim', () => {
  it('should grant a reward to a player on first claim', async () => {
    await seedPlayer('player-1');

    const response = await server.inject({
      method: 'POST',
      url: '/v1/rewards/welcome-bonus/claim',
      headers: { 'idempotency-key': 'claim-key-1' },
      payload: { playerId: 'player-1' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rewardId).toBe('welcome-bonus');
    expect(body.playerId).toBe('player-1');

    // Verify via GET wallet
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    const walletBody = wallet.json();
    expect(walletBody.claimedRewards).toHaveLength(1);
    expect(walletBody.claimedRewards[0].rewardId).toBe('welcome-bonus');
  });

  it('should reject second claim by same player with different key (already claimed)', async () => {
    await seedPlayer('player-1');

    // First claim — succeeds
    const first = await server.inject({
      method: 'POST',
      url: '/v1/rewards/daily-reward/claim',
      headers: { 'idempotency-key': 'claim-first' },
      payload: { playerId: 'player-1' },
    });
    expect(first.statusCode).toBe(200);

    // Second claim attempt — different key, same reward+player → already claimed
    const second = await server.inject({
      method: 'POST',
      url: '/v1/rewards/daily-reward/claim',
      headers: { 'idempotency-key': 'claim-second-attempt' },
      payload: { playerId: 'player-1' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('already_claimed');
  });

  it('should replay same response on duplicate claim with same key (idempotent retry)', async () => {
    await seedPlayer('player-1');

    const requestOptions = {
      method: 'POST' as const,
      url: '/v1/rewards/level-up-reward/claim',
      headers: { 'idempotency-key': 'claim-dup-key' },
      payload: { playerId: 'player-1' },
    };

    // First claim
    const first = await server.inject(requestOptions);
    expect(first.statusCode).toBe(200);

    // Retry with same key — should replay, not error
    const second = await server.inject(requestOptions);
    expect(second.statusCode).toBe(200);
    expect(second.json().rewardId).toBe('level-up-reward');

    // Only one reward in wallet
    const wallet = await server.inject({
      method: 'GET',
      url: '/v1/wallets/player-1',
    });
    expect(wallet.json().claimedRewards).toHaveLength(1);
  });

  it('should allow different players to claim the same reward', async () => {
    await seedPlayer('player-1');
    await seedPlayer('player-2');

    const r1 = await server.inject({
      method: 'POST',
      url: '/v1/rewards/global-event/claim',
      headers: { 'idempotency-key': 'claim-p1' },
      payload: { playerId: 'player-1' },
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await server.inject({
      method: 'POST',
      url: '/v1/rewards/global-event/claim',
      headers: { 'idempotency-key': 'claim-p2' },
      payload: { playerId: 'player-2' },
    });
    expect(r2.statusCode).toBe(200);
  });
});
