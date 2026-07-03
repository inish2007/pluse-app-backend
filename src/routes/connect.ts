import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../db/pool.js';
import {
  createCouple,
  findUserById,
  findUserByPersonalCode,
  isUserAlreadyPaired
} from '../db/users.js';
import { broadcastToUser } from '../websocket/index.js';

interface ConnectBody {
  personalCode: unknown;
}

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

export const connectRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: ConnectBody }>(
    '/couple/connect',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
      }

      const personalCodeRaw = request.body?.personalCode;
      if (typeof personalCodeRaw !== 'string' || personalCodeRaw.trim() === '') {
        return sendError(reply, 400, 'PERSONAL_CODE_REQUIRED', 'personalCode is required.');
      }

      const personalCode = personalCodeRaw.trim().toUpperCase();

      try {
        const result = await withTransaction(async () => {
          const currentUser = await findUserById(userId);
          if (!currentUser) {
            throw new Error('CURRENT_USER_NOT_FOUND');
          }

          const partner = await findUserByPersonalCode(personalCode);
          if (!partner) {
            throw new Error('USER_NOT_FOUND');
          }

          if (partner.id === currentUser.id) {
            throw new Error('CANNOT_CONNECT_TO_SELF');
          }

          const [currentPaired, partnerPaired] = await Promise.all([
            isUserAlreadyPaired(currentUser.id),
            isUserAlreadyPaired(partner.id)
          ]);

          if (currentPaired || partnerPaired) {
            throw new Error('COUPLE_ALREADY_EXISTS');
          }

          const coupleId = await createCouple(currentUser.id, partner.id);

          return {
            coupleId,
            partner: {
              id: partner.id,
              name: partner.name,
              personalCode: partner.personal_code as string
            },
            currentUser
          };
        });

        app.log.info(
          { userId, coupleId: result.coupleId, partnerId: result.partner.id },
          'couple connected'
        );

        const partnerPayload = {
          type: 'PARTNER_CONNECTED',
          coupleId: result.coupleId,
          partner: {
            id: userId,
            name: result.currentUser.name,
            personalCode: result.currentUser.personal_code
          }
        };

        const currentUserPayload = {
          type: 'PARTNER_CONNECTED',
          coupleId: result.coupleId,
          partner: result.partner
        };

        await Promise.all([
          broadcastToUser(result.partner.id, partnerPayload).catch((error) => {
            app.log.warn({ error, targetUserId: result.partner.id }, 'Failed to notify partner');
          }),
          broadcastToUser(userId, currentUserPayload).catch((error) => {
            app.log.warn({ error, targetUserId: userId }, 'Failed to notify current user');
          })
        ]);

        return reply.send({
          success: true,
          coupleId: result.coupleId,
          partner: result.partner
        });
      } catch (error: any) {
        if (error.message === 'CURRENT_USER_NOT_FOUND') {
          return sendError(reply, 404, 'USER_NOT_FOUND', 'Invalid personal code.');
        }

        if (error.message === 'USER_NOT_FOUND') {
          return sendError(reply, 404, 'USER_NOT_FOUND', 'Invalid personal code.');
        }

        if (error.message === 'CANNOT_CONNECT_TO_SELF') {
          return sendError(reply, 400, 'CANNOT_CONNECT_TO_SELF', 'You cannot connect to yourself.');
        }

        if (error.message === 'COUPLE_ALREADY_EXISTS') {
          return sendError(reply, 409, 'COUPLE_ALREADY_EXISTS', 'One or both users are already paired.');
        }

        app.log.error({ error, userId, personalCode }, 'Failed to connect couple');
        return sendError(reply, 500, 'COUPLE_CONNECT_FAILED', 'Failed to connect couple.');
      }
    }
  );
};
