import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db.js';
import { validate, playerIdSchema } from '../validation.js';

/**
 * GET /v1/wallets/:playerId
 *
 * Returns the player's current balance, inventory, and claimed rewards.
 * Read-only endpoint used for state assertions.
 */
export async function getWalletRoute(server: FastifyInstance) {
  server.get<{
    Params: { playerId: string };
  }>('/v1/wallets/:playerId', {
    preHandler: validate({
      params: z.object({ playerId: playerIdSchema }),
    }),
  }, async (request, reply) => {
    const { playerId } = request.params;

    // Fetch account balance
    const accountResult = await query(
      'SELECT balance FROM accounts WHERE player_id = $1',
      [playerId]
    );

    if (accountResult.rows.length === 0) {
      return reply.status(404).send({
        error: { code: 'player_not_found', message: `Player ${playerId} not found` },
      });
    }

    const balance = parseInt(accountResult.rows[0].balance, 10);

    // Fetch inventory
    const inventoryResult = await query(
      'SELECT item_id, price, created_at FROM inventory WHERE player_id = $1 ORDER BY created_at',
      [playerId]
    );
    const inventory = inventoryResult.rows.map(row => ({
      itemId: row.item_id,
      price: parseInt(row.price, 10),
      createdAt: row.created_at,
    }));

    // Fetch claimed rewards
    const rewardsResult = await query(
      'SELECT reward_id, claimed_at FROM reward_claims WHERE player_id = $1 ORDER BY claimed_at',
      [playerId]
    );
    const claimedRewards = rewardsResult.rows.map(row => ({
      rewardId: row.reward_id,
      claimedAt: row.claimed_at,
    }));

    return reply.status(200).send({
      playerId,
      balance,
      inventory,
      claimedRewards,
    });
  });
}
