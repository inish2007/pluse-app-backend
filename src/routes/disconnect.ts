import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../db/pool.js';
import { deleteCouple, findCoupleByUser, findUserById } from '../db/users.js';
import { broadcastToUser } from '../websocket/index.js';

const sendError = (
  reply: any,
  statusCode: number,
  code: string,
  message: string
) => {
  return reply.status(statusCode).send({
    success: false,
    code,
    message
  });
};

export const disconnectRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post('/couple/disconnect', { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user?.userId;
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
    }

    try {
      const result = await withTransaction(async () => {
        const user = await findUserById(userId);
        if (!user) {
          throw new Error('USER_NOT_FOUND');
        }

        const couple = await findCoupleByUser(userId);
        if (!couple) {
          throw new Error('COUPLE_NOT_FOUND');
        }

        const partnerId = couple.user1_id === userId ? couple.user2_id : couple.user1_id;

        await deleteCouple(couple.id);

        return {
          coupleId: couple.id,
          partnerId,
          userId
        };
      });

      app.log.info({ userId, coupleId: result.coupleId, partnerId: result.partnerId }, 'couple disconnected');

      const notifications = [
        broadcastToUser(userId, {
          type: 'COUPLE_DISCONNECTED',
          coupleId: result.coupleId
        }).catch((error) => {
          app.log.warn({ error, targetUserId: userId }, 'Failed to notify disconnecting user');
        })
      ];

      if (result.partnerId) {
        notifications.push(
          broadcastToUser(result.partnerId, {
            type: 'COUPLE_DISCONNECTED',
            coupleId: result.coupleId
          }).catch((error) => {
            app.log.warn({ error, targetUserId: result.partnerId }, 'Failed to notify partner');
          })
        );
      }

      await Promise.all(notifications);

      return reply.send({ success: true });
    } catch (error: any) {
      if (error.message === 'COUPLE_NOT_FOUND') {
        return sendError(reply, 404, 'COUPLE_NOT_FOUND', 'User is not currently paired.');
      }

      if (error.message === 'USER_NOT_FOUND') {
        return sendError(reply, 404, 'USER_NOT_FOUND', 'User not found.');
      }

      app.log.error({ error, userId }, 'Failed to disconnect couple');
      return sendError(reply, 500, 'COUPLE_DISCONNECT_FAILED', 'Failed to disconnect couple.');
    }
  });
};
