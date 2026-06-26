import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { withTransaction } from './db.js';
import type pg from 'pg';

/**
 * Idempotency middleware for mutating endpoints.
 *
 * Strategy (all inside ONE database transaction):
 * 1. INSERT the idempotency key with status='in_progress'. ON CONFLICT DO NOTHING.
 * 2. If 0 rows returned → key exists already:
 *    - status='completed' + matching hash → replay stored response (exactly-once).
 *    - status='completed' + different hash → 409 (key reused with different payload).
 *    - status='in_progress' → 409 (concurrent request with same key is mid-flight).
 * 3. If we won the insert → run the business logic in the SAME transaction,
 *    then UPDATE the key to 'completed' with the stored response, then COMMIT.
 *
 * Because the idempotency record and the business effect commit atomically:
 * - kill -9 before COMMIT → Postgres rolls back everything → retry reprocesses cleanly.
 * - kill -9 after COMMIT but before response reaches client → retry hits the
 *   "completed" branch and replays the cached response.
 * Either way: exactly one effect.
 */

/**
 * Compute a hash of the request to detect key reuse with different payload.
 */
function computeRequestHash(method: string, url: string, body: unknown): string {
  const content = JSON.stringify({ method, url, body });
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * The handler function type that business logic must conform to.
 * It receives the Fastify request, reply, and the DB client (already inside a transaction).
 * It must return { status: number, body: object } — the response to send AND store.
 */
export interface IdempotentResult {
  status: number;
  body: Record<string, unknown>;
}

export type IdempotentHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
  client: pg.PoolClient
) => Promise<IdempotentResult>;

/**
 * Wraps a route handler with idempotency logic.
 * The returned handler enforces the Idempotency-Key header and deduplicates requests.
 */
export function withIdempotency(
  endpoint: string,
  handler: IdempotentHandler
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      return reply.status(400).send({
        error: {
          code: 'missing_idempotency_key',
          message: 'The Idempotency-Key header is required for mutating requests',
        },
      });
    }

    const requestHash = computeRequestHash(request.method, request.url, request.body);

    const result = await withTransaction(async (client) => {
      // Step 1: Try to insert the idempotency key
      const insertResult = await client.query(
        `INSERT INTO idempotency_keys (key, endpoint, request_hash, status)
         VALUES ($1, $2, $3, 'in_progress')
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [idempotencyKey, endpoint, requestHash]
      );

      if (insertResult.rows.length === 0) {
        // Key already exists — look it up
        const existing = await client.query(
          `SELECT status, request_hash, response_status, response_body
           FROM idempotency_keys WHERE key = $1`,
          [idempotencyKey]
        );

        const record = existing.rows[0];

        if (record.status === 'in_progress') {
          // Another request with the same key is currently being processed
          return {
            status: 409,
            body: {
              error: {
                code: 'idempotency_key_in_progress',
                message: 'A request with this idempotency key is already being processed',
              },
            },
          };
        }

        // status === 'completed'
        if (record.request_hash !== requestHash) {
          // Same key but different payload — client bug
          return {
            status: 409,
            body: {
              error: {
                code: 'idempotency_key_reuse',
                message: 'This idempotency key was already used with a different request payload',
              },
            },
          };
        }

        // Same key, same payload — replay the stored response
        return {
          status: record.response_status as number,
          body: record.response_body as Record<string, unknown>,
        };
      }

      // Step 3: We won the insert — run the business logic
      const handlerResult = await handler(request, reply, client);

      // Store the response for future replays
      await client.query(
        `UPDATE idempotency_keys
         SET status = 'completed', response_status = $1, response_body = $2
         WHERE key = $3`,
        [handlerResult.status, JSON.stringify(handlerResult.body), idempotencyKey]
      );

      return handlerResult;
    });

    return reply.status(result.status).send(result.body);
  };
}
