import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { firebaseAuth } from '../firebase/admin.js';
import { upsertFirebaseUser, findCurrentCoupleId } from '../db/users.js';
import { generateBackendToken } from '../utils/jwt.js';

interface LoginBody {
  firebaseToken: string;
}

export const authRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const sendError = (reply: any, statusCode: number, code: string, message: string) =>
    reply.status(statusCode).send({
      success: false,
      code,
      message
    });

  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const { firebaseToken } = request.body || {};

    if (!firebaseToken || typeof firebaseToken !== 'string') {
      return sendError(reply, 400, 'FIREBASE_TOKEN_REQUIRED', 'firebaseToken is required.');
    }

    if (!firebaseAuth) {
      app.log.warn('Firebase Admin auth is not initialized. Cannot verify token.');
      return sendError(reply, 503, 'FIREBASE_AUTH_UNAVAILABLE', 'Firebase auth not available.');
    }

    let decodedToken;
    try {
      decodedToken = await firebaseAuth.verifyIdToken(firebaseToken);
    } catch (error) {
      app.log.warn({ error }, 'Firebase token verification failed');
      return sendError(reply, 401, 'INVALID_FIREBASE_TOKEN', 'Invalid Firebase token.');
    }

    const email = decodedToken.email ?? `${decodedToken.uid}@firebase.local`;
    const displayName = decodedToken.name?.trim() || email;

    try {
      const user = await upsertFirebaseUser(decodedToken.uid, email, displayName);
      const coupleId = await findCurrentCoupleId(user.id);
      const token = generateBackendToken({
        userId: user.id,
        firebaseUid: user.firebase_uid,
        coupleId
      });

      return reply.send({
        success: true,
        token,
        expiresIn: '7d',
        user: {
          id: user.id,
          firebaseUid: user.firebase_uid,
          name: user.name,
          email: user.email,
          personalCode: user.personal_code,
          coupleId
        }
      });
    } catch (error) {
      app.log.error({ error }, 'Failed to synchronize Firebase user or create backend token');
      return sendError(reply, 500, 'AUTHENTICATION_FAILED', 'Failed to authenticate user.');
    }
  });
};
