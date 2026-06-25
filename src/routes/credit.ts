import { type FastifyInstance } from 'fastify';
import { withTransaction } from '../db.js';

/**
 * POST /v1/wallets/:playerId/credit
 *
 * Adds currency to a player's wallet (simulates a battle payout).
 * Creates the account if it doesn't exist (upsert).
 * Records every credit in the append-only ledger for auditability.
 */
export async function creditRoute(server: FastifyInstance) {
  server.post<{
    Params: { playerId: string };
    Body: { amount: number; reason: string };
  }>('/v1/wallets/:playerId/credit', async (request, reply) => {
    const { playerId } = request.params;
    const { amount, reason } = request.body;

    const result = await withTransaction(async (client) => {
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

      return newBalance;
    });

    return reply.status(200).send({
      playerId,
      balance: result,
    });
  });
}
