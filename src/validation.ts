import { z } from 'zod';
import { type FastifyRequest, type FastifyReply } from 'fastify';

// String limits to prevent oversized payload attacks
export const playerIdSchema = z.string().min(1).max(100);
export const itemIdSchema = z.string().min(1).max(100);
export const rewardIdSchema = z.string().min(1).max(100);

export const creditBodySchema = z.object({
  amount: z.number().int().positive().max(1_000_000_000), // Cap at 1 billion
  reason: z.string().min(1).max(500),
}).strict(); // Reject extra/unknown fields

export const purchaseBodySchema = z.object({
  itemId: itemIdSchema,
  price: z.number().int().positive().max(1_000_000_000),
}).strict();

export const claimBodySchema = z.object({
  playerId: playerIdSchema,
}).strict();

interface ValidationSchemas {
  body?: z.ZodSchema;
  params?: z.ZodSchema;
}

/**
 * Reusable Fastify preHandler hook to validate request body and parameters using Zod.
 */
export function validate(schemas: ValidationSchemas) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (schemas.params) {
      const result = schemas.params.safeParse(request.params);
      if (!result.success) {
        return reply.status(400).send({
          error: {
            code: 'validation_error',
            message: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
          },
        });
      }
      request.params = result.data; // Safe parsed data
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({
          error: {
            code: 'validation_error',
            message: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', '),
          },
        });
      }
      request.body = result.data; // Safe parsed data
    }
  };
}
