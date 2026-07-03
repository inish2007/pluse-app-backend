import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { getUserPersonalCode } from '../db/users.js';

export const meRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/me/code', { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user?.userId;
    if (!userId) {
      return reply.status(401).send({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Unauthorized.'
      });
    }

    try {
      const personalCode = await getUserPersonalCode(userId);

      if (!personalCode) {
        return reply.status(404).send({
          success: false,
          code: 'USER_NOT_FOUND',
          message: 'User not found.'
        });
      }

      return reply.send({
        success: true,
        personalCode
      });
    } catch (error) {
      request.log.error({ error, userId }, 'Failed to fetch personal code');
      return reply.status(500).send({
        success: false,
        code: 'PERSONAL_CODE_LOOKUP_FAILED',
        message: 'Failed to fetch personal code.'
      });
    }
  });
};
