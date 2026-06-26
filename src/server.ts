import Fastify, { type FastifyInstance } from 'fastify';
import { creditRoute } from './routes/credit.js';
import { purchaseRoute } from './routes/purchase.js';
import { getWalletRoute } from './routes/getWallet.js';
import { claimRoute } from './routes/claim.js';

/**
 * Build and configure the Fastify server with all routes.
 * Separated from start() so tests can use the same server via inject()
 * without binding to a port.
 */
export function buildServer(): FastifyInstance {
  const server = Fastify({
    bodyLimit: 10240, // 10KB payload limit to prevent DoS
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // --- Global Error Handler ---
  server.setErrorHandler((error: any, request, reply) => {
    if (error.statusCode === 413 || error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        error: {
          code: 'payload_too_large',
          message: 'Request payload exceeds the maximum allowed size of 10KB',
        },
      });
    }

    if (error.statusCode === 400) {
      return reply.status(400).send({
        error: {
          code: 'bad_request',
          message: error.message || 'Malformed request body or parameters',
        },
      });
    }

    // Log the actual unexpected error
    request.log.error(error);
    return reply.status(500).send({
      error: {
        code: 'internal_server_error',
        message: 'An unexpected error occurred on the server',
      },
    });
  });

  // --- Health check ---
  server.get('/health', async () => {
    return { status: 'ok' };
  });

  // --- Routes ---
  creditRoute(server);
  purchaseRoute(server);
  getWalletRoute(server);
  claimRoute(server);

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
