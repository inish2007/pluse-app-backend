import type { FastifyReply, FastifyRequest, FastifyPluginAsync } from 'fastify';
import { parseBearerToken, verifyBackendJwt, JwtVerificationError } from '../utils/jwt.js';

const sendUnauthorized = (reply: FastifyReply, message: string) => {
  return reply.status(401).send({ error: 'Unauthorized', message });
};

export const authenticateRequest = async (request: FastifyRequest, reply: FastifyReply) => {
  const token = parseBearerToken(request.headers.authorization);

  if (!token) {
    return sendUnauthorized(reply, 'Missing or malformed Authorization header');
  }

  try {
    request.user = verifyBackendJwt(token);
    return;
  } catch (error) {
    if (error instanceof JwtVerificationError && error.statusCode === 500) {
      request.log.error({ error }, 'JWT secret is not configured');
      return reply.status(500).send({ error: 'Internal Server Error' });
    }

    const message = error instanceof Error ? error.message : 'Invalid token';
    return sendUnauthorized(reply, message);
  }
};

export const authMiddleware: FastifyPluginAsync = async (app) => {
  app.decorate('authenticate', authenticateRequest);
};
