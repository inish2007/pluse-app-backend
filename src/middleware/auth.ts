import type { FastifyReply, FastifyRequest, FastifyPluginAsync } from 'fastify';
import { parseBearerToken, verifyBackendJwt, JwtVerificationError } from '../utils/jwt.js';

const sendUnauthorized = (reply: FastifyReply, message: string) => {
  return reply.status(401).send({ error: 'Unauthorized', message });
};

export const authenticateRequest = async (request: FastifyRequest, reply: FastifyReply) => {
  const authorizationHeader = request.headers.authorization;
  const authorizationHeaderPresent = typeof authorizationHeader === 'string' && authorizationHeader.length > 0;
  request.log.info({ authorizationHeaderPresent }, 'Auth middleware: Authorization header present');

  const token = parseBearerToken(request.headers.authorization);
  request.log.info({ jwtExtracted: Boolean(token), jwtPrefix: token ? token.slice(0, 20) : null }, 'Auth middleware: JWT extracted');

  if (!token) {
    return sendUnauthorized(reply, 'Missing or malformed Authorization header');
  }

  try {
    request.user = verifyBackendJwt(token);
    request.log.info({ userId: request.user?.userId, firebaseUid: request.user?.firebaseUid }, 'Auth middleware: JWT verification passed');
    return;
  } catch (error) {
    if (error instanceof JwtVerificationError && error.statusCode === 500) {
      request.log.error({ error }, 'JWT secret is not configured');
      return reply.status(500).send({ error: 'Internal Server Error' });
    }

    const message = error instanceof Error ? error.message : 'Invalid token';
    request.log.warn({ error, reason: message, jwtPrefix: token.slice(0, 20) }, 'Auth middleware: JWT verification failed');
    return sendUnauthorized(reply, message);
  }
};

export const authMiddleware: FastifyPluginAsync = async (app) => {
  app.decorate('authenticate', authenticateRequest);
};
