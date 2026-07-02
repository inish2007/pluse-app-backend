import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../db/pool.js';
import { broadcastToUser, sendPushNotificationFallback } from '../websocket/index.js';

interface SendSignalRequest {
  Body: {
    signal_type: 'vibrate' | 'heart' | 'kiss' | 'thinking';
    couple_id: string;
  };
}

interface SignalListRequest {
  Params: {
    coupleId: string;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; name?: string; email?: string };
  }
}

export const signalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /signal/send - Send vibration/signal to partner
  app.post<SendSignalRequest>('/signal/send', async (request, reply) => {
    const senderId = (request.user as any)?.id;
    if (!senderId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { signal_type, couple_id } = request.body;

    if (!signal_type || !couple_id) {
      return reply.status(400).send({ error: 'Missing signal_type or couple_id' });
    }

    try {
      const result = await withTransaction(async (client: any) => {
        // Verify couple exists and user is part of it
        const coupleRes = await client.query(
          `SELECT * FROM couples 
           WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
          [couple_id, senderId]
        );

        if (coupleRes.rows.length === 0) {
          throw new Error('COUPLE_NOT_FOUND_OR_UNAUTHORIZED');
        }

        const couple = coupleRes.rows[0];
        const recipientId = couple.user1_id === senderId ? couple.user2_id : couple.user1_id;

        if (!recipientId) {
          throw new Error('PARTNER_NOT_CONNECTED');
        }

        // Store signal in database
        const signalRes = await client.query(
          `INSERT INTO signals (sender_id, recipient_id, couple_id, signal_type, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           RETURNING id`,
          [senderId, recipientId, couple_id, signal_type]
        );

        return {
          signalId: signalRes.rows[0].id,
          recipientId,
          senderName: (request.user as any)?.name || 'Partner'
        };
      });

      // Notify partner via WebSocket or FCM
      await broadcastToUser(result.recipientId, {
        type: 'SIGNAL_RECEIVED',
        signal_type,
        sender_id: senderId,
        sender_name: result.senderName,
        signal_id: result.signalId
      });

      return reply.status(200).send({
        success: true,
        signal_id: result.signalId
      });
    } catch (error: any) {
      app.log.error(error);
      const statusCode = error.message.includes('NOT_FOUND') ? 404 : 400;
      return reply.status(statusCode).send({ 
        error: error.message || 'Failed to send signal' 
      });
    }
  });

  // GET /signal/pending/:coupleId - Get pending signals
  app.get<SignalListRequest>('/signal/pending/:coupleId', async (request, reply) => {
    const userId = (request.user as any)?.id;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const { coupleId } = request.params;

    try {
      const result = await withTransaction(async (client: any) => {
        // Verify user is part of this couple
        const coupleCheck = await client.query(
          `SELECT * FROM couples 
           WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
          [coupleId, userId]
        );

        if (coupleCheck.rows.length === 0) {
          throw new Error('UNAUTHORIZED');
        }

        // Get pending signals for this user
        const signals = await client.query(
          `SELECT id, sender_id, signal_type, created_at, acknowledged_at
           FROM signals
           WHERE couple_id = $1 AND recipient_id = $2 
           ORDER BY created_at DESC
           LIMIT 50`,
          [coupleId, userId]
        );

        return signals.rows;
      });

      return reply.status(200).send({
        success: true,
        signals: result
      });
    } catch (error: any) {
      app.log.error(error);
      return reply.status(error.message === 'UNAUTHORIZED' ? 403 : 500).send({ 
        error: error.message 
      });
    }
  });

  // POST /signal/:signalId/acknowledge - Mark signal as received
  app.post<SendSignalRequest>('/signal/:signalId/acknowledge', async (request, reply) => {
    const userId = (request.user as any)?.id;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const signalId = (request.params as any).signalId;

    try {
      const result = await withTransaction(async (client: any) => {
        // Verify this is the recipient
        const signal = await client.query(
          `SELECT * FROM signals WHERE id = $1`,
          [signalId]
        );

        if (signal.rows.length === 0) {
          throw new Error('SIGNAL_NOT_FOUND');
        }

        const signalRecord = signal.rows[0];
        if (signalRecord.recipient_id !== userId) {
          throw new Error('UNAUTHORIZED');
        }

        // Mark as acknowledged
        await client.query(
          `UPDATE signals SET acknowledged_at = NOW() WHERE id = $1`,
          [signalId]
        );

        return signalRecord;
      });

      return reply.status(200).send({ success: true });
    } catch (error: any) {
      app.log.error(error);
      return reply.status(error.message === 'UNAUTHORIZED' ? 403 : 404).send({ 
        error: error.message 
      });
    }
  });
};
