import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import WebSocket from 'ws';
import { parseBearerToken, verifyBackendJwt, JwtVerificationError } from '../utils/jwt.js';
import { findCoupleByUser, updateUserLastSeen } from '../db/users.js';
import {
  markSignalDelivered,
  markSignalFailed,
  sendPushNotificationFallback
} from '../services/fcm.js';

const activeConnections = new Map<string, Set<WebSocket>>();
const onlineUsers = new Set<string>();
const userSessions = new Map<string, { userId: string; email: string; name?: string }>();
const socketHeartbeats = new Map<WebSocket, { userId: string; lastPongAt: number }>();
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
let heartbeatTimer: NodeJS.Timeout | null = null;

export { sendPushNotificationFallback };

export const broadcastToUser = async (userId: string, payload: any) => {
  const sockets = activeConnections.get(userId);

  if (sockets && sockets.size > 0) {
    try {
      let deliveredViaWs = false;
      for (const ws of sockets) {
        try {
          ws.send(JSON.stringify(payload));
          deliveredViaWs = true;
        } catch (error) {
          console.warn('[WS] send failed for one socket', { userId, error });
        }
      }

      if (deliveredViaWs) {
        console.info('[WS] event emitted', { userId, type: payload?.type });
        if (payload?.signalId) {
          void markSignalDelivered(payload.signalId).catch((error) => {
            console.warn('[WS] failed to update delivery status to delivered', { signalId: payload.signalId, error });
          });
        }
        return;
      }

      return;
    } catch (error) {
      console.warn('[WS] send failed, falling back to FCM', { userId, error });
    }
  }

  void (async () => {
    const deliveryResult = await sendPushNotificationFallback(userId, payload);
    if (deliveryResult.delivered) {
      if (payload?.signalId) {
        await markSignalDelivered(payload.signalId).catch((error) => {
          console.warn('[FCM] failed to update delivery status to delivered', { signalId: payload.signalId, error });
        });
      }
    } else if (payload?.signalId) {
      await markSignalFailed(payload.signalId).catch((error) => {
        console.warn('[FCM] failed to update delivery status to failed', { signalId: payload.signalId, error });
      });
    }
  })();
};

const broadcastPartnerPresence = async (userId: string, eventType: 'PARTNER_ONLINE' | 'PARTNER_OFFLINE') => {
  const couple = await findCoupleByUser(userId);
  if (!couple) {
    return;
  }

  const partnerId = couple.user1_id === userId ? couple.user2_id : couple.user1_id;
  if (!partnerId) {
    return;
  }

  const sockets = activeConnections.get(partnerId);
  if (!sockets || sockets.size === 0) {
    return;
  }

  for (const ws of sockets) {
    try {
      ws.send(JSON.stringify({
        type: eventType,
        partnerId: userId
      }));
    } catch (error) {
      console.warn('[WS] failed to broadcast partner presence', { partnerId, error });
    }
  }
};

const handleSocketClose = async (userId: string, connection: WebSocket) => {
  // close and error can both fire for the same socket. The heartbeat entry is
  // the ownership marker that makes cleanup idempotent.
  if (!socketHeartbeats.delete(connection)) {
    return;
  }

  connection.removeAllListeners('message');
  connection.removeAllListeners('pong');
  connection.removeAllListeners('close');
  connection.removeAllListeners('error');
  // Keep a no-op error listener while ws finishes tearing down the transport.
  connection.on('error', () => undefined);

  const sockets = activeConnections.get(userId);
  if (sockets) {
    sockets.delete(connection);
    console.info('[WS] socket removed', { userId, remainingSockets: sockets.size });
    if (sockets.size > 0) {
      return;
    }
    activeConnections.delete(userId);
  }

  const wasOnline = onlineUsers.delete(userId);
  userSessions.delete(userId);

  if (wasOnline) {
    console.info('[WS] presence transition', { userId, state: 'offline' });
    await updateUserLastSeen(userId).catch((error) => {
      console.warn('[WS] failed to update last_seen_at', { userId, error });
    });

    await broadcastPartnerPresence(userId, 'PARTNER_OFFLINE').catch((error) => {
      console.warn('[WS] failed to broadcast partner offline', { userId, error });
    });
  }

  console.info('[WS] disconnected', { userId });
};

const ensureHeartbeatLoop = () => {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    const now = Date.now();

    for (const [userId, sockets] of activeConnections.entries()) {
      for (const ws of sockets) {
        const heartbeat = socketHeartbeats.get(ws);
        if (!heartbeat) {
          continue;
        }

        if (now - heartbeat.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          console.warn('[WS] heartbeat timeout', { userId });
          ws.terminate();
          continue;
        }

        try {
          ws.ping();
          console.debug('[WS] heartbeat sent', { userId });
        } catch (error) {
          console.warn('[WS] heartbeat ping failed', { userId, error });
          ws.terminate();
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  heartbeatTimer.unref?.();
};

export const websocketPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  ensureHeartbeatLoop();

  app.addHook('onClose', async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    for (const sockets of activeConnections.values()) {
      for (const connection of sockets) {
        connection.terminate();
      }
    }

    activeConnections.clear();
    onlineUsers.clear();
    userSessions.clear();
    socketHeartbeats.clear();
  });

  app.get('/ws', { websocket: true }, (connection, req) => {
    console.info('[WS] socket connected');
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bearerToken = parseBearerToken(req.headers.authorization);
    const queryToken = url.searchParams.get('token');
    const token = bearerToken ?? queryToken;

    if (!token) {
      console.info('[WS] rejected connection', { reason: 'missing token' });
      connection.close(4001, 'Missing token');
      return;
    }

    let payload;
    try {
      payload = verifyBackendJwt(token);
    } catch (error) {
      if (error instanceof JwtVerificationError) {
        console.info('[WS] rejected connection', { reason: error.message });
      } else {
        console.info('[WS] rejected connection', { reason: 'invalid token' });
      }
      connection.close(4002, 'Invalid token');
      return;
    }

    const userId = payload.userId;
    const nextSockets = activeConnections.get(userId) ?? new Set<WebSocket>();
    const wasOnline = onlineUsers.has(userId);
    nextSockets.add(connection);
    activeConnections.set(userId, nextSockets);
    onlineUsers.add(userId);
    socketHeartbeats.set(connection, { userId, lastPongAt: Date.now() });

    userSessions.set(userId, {
      userId,
      email: payload.firebaseUid,
      name: 'User'
    });

    console.info('[WS] socket authenticated', { userId, socketCount: nextSockets.size });

    if (!wasOnline) {
      console.info('[WS] presence transition', { userId, state: 'online' });
      void broadcastPartnerPresence(userId, 'PARTNER_ONLINE').catch((error) => {
        console.warn('[WS] failed to broadcast partner online', { userId, error });
      });
    }

    connection.on('message', (message: any) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'PING') {
          connection.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    connection.on('pong', () => {
      const heartbeat = socketHeartbeats.get(connection);
      if (heartbeat) {
        heartbeat.lastPongAt = Date.now();
      }
    });

    connection.on('close', () => {
      void handleSocketClose(userId, connection);
    });

    connection.on('error', (error: any) => {
      console.error('[WS] error', { userId, error });
      void handleSocketClose(userId, connection);
    });
  });
};
