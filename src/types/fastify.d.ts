import type { BackendJwtPayload } from '../utils/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: BackendJwtPayload;
  }

  interface FastifyInstance {
    authenticate: import('fastify').preHandlerHookHandler;
  }
}
