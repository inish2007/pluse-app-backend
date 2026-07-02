import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import WebSocket from 'ws';
import * as admin from 'firebase-admin';
import { verifyToken } from '../utils/jwt.js';

// Map of userId -> WebSocket instance
const activeConnections = new Map<string, WebSocket>();
const userSessions = new Map<string, { userId: string; email: string; name?: string }>();

// Initialize FCM (Ensure GOOGLE_APPLICATION_CREDENTIALS is set in env)
try {
  if (admin.apps.length === 0) {
    admin.initializeApp();
  }
} catch (err) {
  console.warn('Firebase Admin not fully initialized check GOOGLE_APPLICATION_CREDENTIALS env var.');
}

/**
 * Fallback to FCM if the user is not actively connected via WebSocket.
 */
export const sendPushNotificationFallback = async (userId: string, payload: any) => {
  try {
     // In a real app, fetch deviceToken from the DB
     // const deviceToken = await fetchDeviceToken(userId);
     const deviceToken = "dummy_fcm_token_for_user"; // Mock for now

     const message = {
      notification: {
        title: payload.notification?.title || 'Pulse Notification',
        body: payload.notification?.body || 'You have a new message'
      },
      data: {
        type: payload.type || 'NOTIFICATION',
        ...payload.data
      },
      token: deviceToken
    };

    if(deviceToken !== "dummy_fcm_token_for_user"){
        await admin.messaging().send(message);
        console.log(`✓ FCM sent to ${userId}`);
    } else {
      console.log(`⚠ No FCM token available for ${userId}`);
    }
  } catch (error) {
    console.error(`Failed to send FCM to ${userId}`, error);
  }
};

/**
 * Broadcasts an event to a specific user.
 */
export const broadcastToUser = async (userId: string, payload: any) => {
  const ws = activeConnections.get(userId);
  if (ws) {
    try {
      ws.send(JSON.stringify(payload));
      console.log(`✓ WS event emitted to ${userId}:`, payload.type);
    } catch (error) {
      console.warn(`Failed to send WS to ${userId}, trying FCM...`, error);
      await sendPushNotificationFallback(userId, payload);
    }
  } else {
    // Offline? Fallback to Push Notification
    console.log(`⚠ User ${userId} offline. Falling back to FCM...`);
    await sendPushNotificationFallback(userId, payload);
  }
};

export const websocketPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/ws', { websocket: true }, (connection, req) => {
    // Extract JWT token from query params
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    
    if (!token) {
      connection.close(4001, 'Missing token');
      return;
    }

    // Verify JWT token
    const payload = verifyToken(token);
    if (!payload) {
      connection.close(4002, 'Invalid token');
      return;
    }

    const userId = payload.id;
    
    // Store connection with user metadata
    activeConnections.set(userId, connection);
    userSessions.set(userId, {
      userId,
      email: payload.email,
      name: payload.name || 'User'
    });
    
    console.log(`✓ WS Connected: User ${userId} (${payload.email})`);

    connection.on('message', (message: any) => {
      // Handle inbound WS messages from client (e.g., heartbeat)
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'PING') {
          connection.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch (e) {
        // Ignore malformed messages
      }
    });

    connection.on('close', () => {
      activeConnections.delete(userId);
      userSessions.delete(userId);
      console.log(`✗ WS Disconnected: User ${userId}`);
    });

    connection.on('error', (error: any) => {
      console.error(`WS Error for user ${userId}:`, error);
      activeConnections.delete(userId);
      userSessions.delete(userId);
    });
  });
};
