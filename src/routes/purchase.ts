import { type FastifyInstance } from 'fastify';
import { withIdempotency } from '../idempotency.js';

/**
 * POST /v1/wallets/:playerId/purchase
 *
 * Atomically debits the player's balance and grants an item to their inventory.
 * If the player cannot afford the item, the purchase is rejected cleanly
 * with no partial effect (no debit without grant, no grant without debit).
 *
 * Concurrency safety: the conditional UPDATE takes a row-level write lock on
 * the account row. Two concurrent purchases on the same wallet serialize on
 * that row — the second waits, then re-evaluates balance >= price against
 * the post-first-purchase balance. This is why READ COMMITTED is sufficient.
 */
export async function purchaseRoute(server: FastifyInstance) {
  server.post('/v1/wallets/:playerId/purchase', withIdempotency(
    'purchase',
    async (request, _reply, client) => {
      const { playerId } = request.params as { playerId: string };
      const { itemId, price } = request.body as { itemId: string; price: number };

      // Conditional UPDATE: debit only if balance is sufficient.
      // This single statement atomically checks and updates — no read-then-write race.
      // It also takes a row-level write lock for the duration of the transaction,
      // serializing concurrent purchases on the same wallet.
      const debitResult = await client.query(
        `UPDATE accounts SET balance = balance - $1
         WHERE player_id = $2 AND balance >= $1
         RETURNING balance`,
        [price, playerId]
      );

      if (debitResult.rows.length === 0) {
        // Either player doesn't exist or insufficient funds.
        // Check which case it is for a clear error message.
        const accountCheck = await client.query(
          'SELECT balance FROM accounts WHERE player_id = $1',
          [playerId]
        );

        if (accountCheck.rows.length === 0) {
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

        return {
          status: 402,
          body: {
            error: {
              code: 'insufficient_funds',
              message: `Insufficient balance. Required: ${price}, available: ${parseInt(accountCheck.rows[0].balance, 10)}`,
            },
          },
        };
      }

      const newBalance = parseInt(debitResult.rows[0].balance, 10);

      // Grant the item to inventory
      await client.query(
        `INSERT INTO inventory (player_id, item_id, price)
         VALUES ($1, $2, $3)`,
        [playerId, itemId, price]
      );

      // Record in the append-only ledger
      await client.query(
        `INSERT INTO ledger (player_id, delta, kind, reason)
         VALUES ($1, $2, $3, $4)`,
        [playerId, -price, 'purchase', `Purchased ${itemId}`]
      );

      return {
        status: 200,
        body: {
          playerId,
          balance: newBalance,
          itemId,
          price,
        },
      };
    }
  ));
}
