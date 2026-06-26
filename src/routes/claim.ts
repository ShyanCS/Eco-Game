import { type FastifyInstance } from 'fastify';
import { withIdempotency } from '../idempotency.js';

/**
 * POST /v1/rewards/:rewardId/claim
 *
 * Grants a reward to a player exactly once.
 * Enforces claim-once semantics at the database level using a composite primary key
 * (reward_id, player_id) in the reward_claims table.
 *
 * Duplicate claims with the same player and reward but different idempotency keys
 * are rejected with a 409 already_claimed.
 */
export async function claimRoute(server: FastifyInstance) {
  server.post('/v1/rewards/:rewardId/claim', withIdempotency(
    'claim',
    async (request, _reply, client) => {
      const { rewardId } = request.params as { rewardId: string };
      const { playerId } = request.body as { playerId: string };

      // 1. Verify player exists
      const playerCheck = await client.query(
        'SELECT 1 FROM accounts WHERE player_id = $1',
        [playerId]
      );

      if (playerCheck.rows.length === 0) {
        return {
          status: 404,
          body: {
            error: {
              code: 'player_not_found',
              message: `Player ${playerId} not found`,
            },
          },
        };
      }

      // 2. Insert the claim record
      const claimResult = await client.query(
        `INSERT INTO reward_claims (reward_id, player_id)
         VALUES ($1, $2)
         ON CONFLICT (reward_id, player_id) DO NOTHING
         RETURNING reward_id`,
        [rewardId, playerId]
      );

      if (claimResult.rows.length === 0) {
        return {
          status: 409,
          body: {
            error: {
              code: 'already_claimed',
              message: `Reward ${rewardId} has already been claimed by player ${playerId}`,
            },
          },
        };
      }

      return {
        status: 200,
        body: {
          rewardId,
          playerId,
        },
      };
    }
  ));
}
