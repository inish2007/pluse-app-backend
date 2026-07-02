import fastify from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { websocketPlugin } from './websocket/index.js';
import { inviteRoutes } from './routes/invite.js';
import { joinRoutes } from './routes/join.js';
import { coupleCodeRoutes } from './routes/couple-code.js';
import { signalRoutes } from './routes/signal.js';

export const buildApp = () => {
  const app = fastify({ logger: true });

  // Rate Limiting for Security Hardening
  app.register(rateLimit, {
    max: 100, // global rate limit
    timeWindow: '1 minute'
  });

  // Register WebSockets
  app.register(websocket);

  // Register plugins (Routes & WS bindings)
  app.register(async (app) => {
    await app.register(websocketPlugin);
    await app.register(inviteRoutes);
    await app.register(joinRoutes);
    await app.register(coupleCodeRoutes);
    await app.register(signalRoutes);
  });

  return app;
};
