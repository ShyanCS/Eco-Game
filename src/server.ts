import Fastify from 'fastify';

const server = Fastify({
  logger: true,
});

// --- Health check ---
server.get('/health', async () => {
  return { status: 'ok' };
});

// --- Stub routes (501 Not Implemented) ---

server.post('/v1/wallets/:playerId/credit', async (_request, reply) => {
  reply.status(501).send({ error: { code: 'not_implemented', message: 'Credit endpoint not yet implemented' } });
});

server.post('/v1/wallets/:playerId/purchase', async (_request, reply) => {
  reply.status(501).send({ error: { code: 'not_implemented', message: 'Purchase endpoint not yet implemented' } });
});

server.post('/v1/rewards/:rewardId/claim', async (_request, reply) => {
  reply.status(501).send({ error: { code: 'not_implemented', message: 'Claim endpoint not yet implemented' } });
});

server.get('/v1/wallets/:playerId', async (_request, reply) => {
  reply.status(501).send({ error: { code: 'not_implemented', message: 'Get wallet endpoint not yet implemented' } });
});

// --- Start ---
const start = async () => {
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

start();

export default server;
