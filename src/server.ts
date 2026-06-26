import Fastify, { type FastifyInstance } from 'fastify';
import { creditRoute } from './routes/credit.js';
import { purchaseRoute } from './routes/purchase.js';
import { getWalletRoute } from './routes/getWallet.js';

/**
 * Build and configure the Fastify server with all routes.
 * Separated from start() so tests can use the same server via inject()
 * without binding to a port.
 */
export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // --- Health check ---
  server.get('/health', async () => {
    return { status: 'ok' };
  });

  // --- Routes ---
  creditRoute(server);
  purchaseRoute(server);
  getWalletRoute(server);

  server.post('/v1/rewards/:rewardId/claim', async (_request, reply) => {
    reply.status(501).send({ error: { code: 'not_implemented', message: 'Claim endpoint not yet implemented' } });
  });

  return server;
}

// --- Start (only when run directly, not when imported by tests) ---
const start = async () => {
  const server = buildServer();
  const host = process.env.HOST ?? '0.0.0.0';
  const port = parseInt(process.env.PORT ?? '3000', 10);

  try {
    await server.listen({ host, port });
    server.log.info(`Server listening on ${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Only start if this file is the entry point
const isDirectRun = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isDirectRun) {
  start();
}
