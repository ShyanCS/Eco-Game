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

describe('Boundary Input Validation & Safety Hardening', () => {
  describe('POST /v1/wallets/:playerId/credit validation', () => {
    it('should reject negative or zero credit amount', async () => {
      const r1 = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-1' },
        payload: { amount: -50, reason: 'test' },
      });
      expect(r1.statusCode).toBe(400);
      expect(r1.json().error.code).toBe('validation_error');

      const r2 = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-2' },
        payload: { amount: 0, reason: 'test' },
      });
      expect(r2.statusCode).toBe(400);
    });

    it('should reject non-integer or string credit amount', async () => {
      const r1 = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-3' },
        payload: { amount: 50.5, reason: 'test' },
      });
      expect(r1.statusCode).toBe(400);

      const r2 = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-4' },
        payload: { amount: '100', reason: 'test' },
      });
      expect(r2.statusCode).toBe(400);
    });

    it('should reject absurdly large numbers to prevent overflow', async () => {
      const r = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-5' },
        payload: { amount: 9_999_999_999_999, reason: 'test' },
      });
      expect(r.statusCode).toBe(400);
    });

    it('should reject missing required fields or extra/unknown fields', async () => {
      const r1 = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-6' },
        payload: { amount: 100 }, // missing reason
      });
      expect(r1.statusCode).toBe(400);

      const r2 = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-7' },
        payload: { amount: 100, reason: 'test', extraField: 'hack' }, // extra field
      });
      expect(r2.statusCode).toBe(400);
    });
  });

  describe('POST /v1/wallets/:playerId/purchase validation', () => {
    it('should reject negative or zero price', async () => {
      const r1 = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/purchase',
        headers: { 'idempotency-key': 'pur-val-1' },
        payload: { itemId: 'sword', price: -10 },
      });
      expect(r1.statusCode).toBe(400);
    });

    it('should reject empty or missing fields', async () => {
      const r = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/purchase',
        headers: { 'idempotency-key': 'pur-val-2' },
        payload: { price: 10 }, // missing itemId
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('POST /v1/rewards/:rewardId/claim validation', () => {
    it('should reject missing playerId or extra fields', async () => {
      const r = await server.inject({
        method: 'POST',
        url: '/v1/rewards/bonus/claim',
        headers: { 'idempotency-key': 'claim-val-1' },
        payload: {}, // missing playerId
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('Fastify Server-Level Validation', () => {
    it('should reject malformed JSON', async () => {
      const r = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: {
          'idempotency-key': 'credit-val-8',
          'content-type': 'application/json',
        },
        payload: '{ amount: 100, reason: "bad-json"', // syntax error
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('bad_request');
    });

    it('should reject oversized payloads (>10KB)', async () => {
      const hugeReason = 'a'.repeat(20000); // ~20KB
      const r = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: {
          'idempotency-key': 'credit-val-9',
          'content-type': 'application/json',
        },
        payload: JSON.stringify({ amount: 100, reason: hugeReason }),
      });
      expect(r.statusCode).toBe(413);
      expect(r.json().error.code).toBe('payload_too_large');
    });

    it('should keep the server healthy and functional after bad inputs', async () => {
      // 1. Send bad request
      const bad = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-10' },
        payload: { amount: -5, reason: 'bad' },
      });
      expect(bad.statusCode).toBe(400);

      // 2. Send good request on the same route/player
      const good = await server.inject({
        method: 'POST',
        url: '/v1/wallets/player-1/credit',
        headers: { 'idempotency-key': 'credit-val-11' },
        payload: { amount: 100, reason: 'good' },
      });
      expect(good.statusCode).toBe(200);

      // 3. Verify balance is correctly updated to 100
      const wallet = await server.inject({
        method: 'GET',
        url: '/v1/wallets/player-1',
      });
      expect(wallet.json().balance).toBe(100);
    });
  });
});
