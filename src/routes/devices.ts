import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { registerUserDevice, unregisterUserDevice } from '../db/devices.js';

interface RegisterDeviceBody {
  fcmToken: unknown;
  platform: unknown;
  deviceName?: unknown;
}

interface UnregisterDeviceBody {
  fcmToken: unknown;
}

export const deviceRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const sendError = (reply: any, statusCode: number, code: string, message: string) =>
    reply.status(statusCode).send({
      success: false,
      code,
      message
    });

  app.post<{ Body: RegisterDeviceBody }>(
    '/devices/register',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
      }

      const { fcmToken, platform, deviceName } = request.body || {};

      if (typeof fcmToken !== 'string' || fcmToken.trim() === '') {
        return sendError(reply, 400, 'FCM_TOKEN_REQUIRED', 'fcmToken is required.');
      }

      if (typeof platform !== 'string' || platform.trim() === '') {
        return sendError(reply, 400, 'PLATFORM_REQUIRED', 'platform is required.');
      }

      const normalizedDeviceName =
        typeof deviceName === 'string' && deviceName.trim() !== '' ? deviceName.trim() : null;

      try {
        await registerUserDevice({
          userId,
          fcmToken: fcmToken.trim(),
          platform: platform.trim(),
          deviceName: normalizedDeviceName
        });

        return reply.send({ success: true });
      } catch (error) {
        request.log.error({ error }, 'Failed to register device');
        return sendError(reply, 500, 'DEVICE_REGISTER_FAILED', 'Failed to register device.');
      }
    }
  );

  app.post<{ Body: UnregisterDeviceBody }>(
    '/devices/unregister',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
      }

      const { fcmToken } = request.body || {};

      if (typeof fcmToken !== 'string' || fcmToken.trim() === '') {
        return sendError(reply, 400, 'FCM_TOKEN_REQUIRED', 'fcmToken is required.');
      }

      try {
        await unregisterUserDevice(userId, fcmToken.trim());
        return reply.send({ success: true });
      } catch (error) {
        request.log.error({ error }, 'Failed to unregister device');
        return sendError(reply, 500, 'DEVICE_UNREGISTER_FAILED', 'Failed to unregister device.');
      }
    }
  );
};
