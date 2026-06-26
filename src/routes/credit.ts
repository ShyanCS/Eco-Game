import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withIdempotency } from '../idempotency.js';
import { validate, creditBodySchema, playerIdSchema } from '../validation.js';

/**
 * POST /v1/wallets/:playerId/credit
 *
 * Adds currency to a player's wallet (simulates a battle payout).
 * Creates the account if it doesn't exist (upsert).
 * Records every credit in the append-only ledger for auditability.
 *
 * Wrapped with idempotency: duplicate requests (same Idempotency-Key)
 * produce the same response without re-applying the credit.
 */
export async function creditRoute(server: FastifyInstance) {
  server.post('/v1/wallets/:playerId/credit', {
    preHandler: validate({
      body: creditBodySchema,
      params: z.object({ playerId: playerIdSchema }),
    }),
  }, withIdempotency(
    'credit',
    async (request, _reply, client) => {
      const { playerId } = request.params as { playerId: string };
      const { amount, reason } = request.body as { amount: number; reason: string };

      // Upsert the account: create if new, add to balance if existing
      const accountResult = await client.query(
        `INSERT INTO accounts (player_id, balance)
         VALUES ($1, $2)
         ON CONFLICT (player_id)
         DO UPDATE SET balance = accounts.balance + $2
         RETURNING balance`,
        [playerId, amount]
      );

      const newBalance = parseInt(accountResult.rows[0].balance, 10);

      // Record in the append-only ledger
      await client.query(
        `INSERT INTO ledger (player_id, delta, kind, reason)
         VALUES ($1, $2, $3, $4)`,
        [playerId, amount, 'credit', reason]
      );

      return {
        status: 200,
        body: {
          playerId,
          balance: newBalance,
        },
      };
    }
  ));
}
