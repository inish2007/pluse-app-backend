import fastify from 'fastify';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import { websocketPlugin } from './websocket/index.js';
import { inviteRoutes } from './routes/invite.js';
import { joinRoutes } from './routes/join.js';
import { coupleCodeRoutes } from './routes/couple-code.js';
import { signalRoutes } from './routes/signal.js';
import { authRoutes } from './routes/auth.js';
import { authMiddleware } from './middleware/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { meRoutes } from './routes/me.js';
import { connectRoutes } from './routes/connect.js';
import { disconnectRoutes } from './routes/disconnect.js';

export const buildApp = () => {
  const app = fastify({ logger: true });

  // Rate Limiting for Security Hardening
  app.register(rateLimit, {
    max: 100, // global rate limit
    timeWindow: '1 minute'
  });

  // Register WebSockets
  app.register(websocket);
  app.register(authMiddleware);

  // Register plugins (Routes & WS bindings)
  app.register(async (app) => {
    await app.register(websocketPlugin);
    await app.register(inviteRoutes);
    await app.register(joinRoutes);
    await app.register(coupleCodeRoutes);
    await app.register(signalRoutes);
    await app.register(authRoutes);
    await app.register(deviceRoutes);
    await app.register(meRoutes);
    await app.register(connectRoutes);
    await app.register(disconnectRoutes);
  });

  return app;
};
