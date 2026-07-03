import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../db/pool.js';
import { markAcknowledged, markPending } from '../db/signals.js';
import { broadcastToUser } from '../websocket/index.js';

interface SendSignalBody {
  signal_type: string;
}

interface LegacyPendingParams {
  coupleId: string;
}

interface AckParams {
  id?: string;
  signalId?: string;
}

const ALLOWED_SIGNAL_TYPES = new Set(['vibrate', 'heart', 'kiss', 'thinking']);

const sendError = (reply: any, statusCode: number, code: string, message: string) =>
  reply.status(statusCode).send({
    success: false,
    code,
    message
  });

const resolveCurrentCouple = async (client: any, userId: string) => {
  const coupleRes = await client.query(
    `SELECT id, user1_id, user2_id
     FROM couples
     WHERE user1_id = $1 OR user2_id = $1
     LIMIT 1`,
    [userId]
  );

  if (coupleRes.rows.length === 0) {
    return null;
  }

  return coupleRes.rows[0];
};

const handleSendSignal = async (app: FastifyInstance, request: any, reply: any) => {
  const senderId = request.user?.userId;
  if (!senderId) {
    app.log.info({ senderId }, 'unauthorized signal send attempt');
    return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
  }

  const signalType = request.body?.signal_type?.trim();

  if (!signalType) {
    return sendError(reply, 400, 'SIGNAL_TYPE_REQUIRED', 'signal_type is required.');
  }

  if (!ALLOWED_SIGNAL_TYPES.has(signalType)) {
    app.log.info({ senderId, signalType }, 'invalid send attempt');
    return sendError(reply, 400, 'INVALID_SIGNAL_TYPE', 'Invalid signal_type.');
  }

  try {
    const result = await withTransaction(async (client: any) => {
      const couple = await resolveCurrentCouple(client, senderId);

      if (!couple) {
        throw new Error('COUPLE_NOT_FOUND');
      }

      const recipientId = couple.user1_id === senderId ? couple.user2_id : couple.user1_id;

      if (!recipientId) {
        throw new Error('PARTNER_NOT_CONNECTED');
      }

      const signalRes = await client.query(
        `INSERT INTO signals (sender_id, recipient_id, couple_id, signal_type, delivery_status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW())
         RETURNING id`,
        [senderId, recipientId, couple.id, signalType]
      );

      await markPending(signalRes.rows[0].id);
      app.log.info({ senderId, recipientId, coupleId: couple.id, signalType }, 'signal created');

      return {
        signalId: signalRes.rows[0].id,
        recipientId,
        coupleId: couple.id
      };
    });

    await broadcastToUser(result.recipientId, {
      type: 'SIGNAL_RECEIVED',
      signal_type: signalType,
      sender_id: senderId,
      signal_id: result.signalId
    }).catch((error) => {
      app.log.warn({ error, targetUserId: result.recipientId, coupleId: result.coupleId }, 'Failed to deliver signal notification');
    });

    app.log.info({ senderId, recipientId: result.recipientId, coupleId: result.coupleId, signalId: result.signalId }, 'signal delivered');

    return reply.status(200).send({
      success: true,
      signal_id: result.signalId
    });
  } catch (error: any) {
    if (error.message === 'COUPLE_NOT_FOUND') {
      return sendError(reply, 404, 'COUPLE_NOT_FOUND', 'User is not currently paired.');
    }

    if (error.message === 'PARTNER_NOT_CONNECTED') {
      return sendError(reply, 409, 'PARTNER_NOT_CONNECTED', 'Partner is not connected.');
    }

    app.log.error({ error, senderId, signalType }, 'Failed to send signal');
    return sendError(reply, 500, 'SIGNAL_SEND_FAILED', 'Failed to send signal.');
  }
};

const handlePendingSignals = async (app: FastifyInstance, request: any, reply: any) => {
  const userId = request.user?.userId;
  if (!userId) {
    app.log.info({ userId }, 'unauthorized pending signal access');
    return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
  }

  try {
    const result = await withTransaction(async (client: any) => {
      const couple = await resolveCurrentCouple(client, userId);

      if (!couple) {
        throw new Error('COUPLE_NOT_FOUND');
      }

      const signals = await client.query(
        `SELECT id, sender_id, signal_type, created_at, acknowledged_at, delivery_status
         FROM signals
         WHERE couple_id = $1
           AND recipient_id = $2
           AND delivery_status != 'acknowledged'
         ORDER BY created_at DESC
         LIMIT 50`,
        [couple.id, userId]
      );

      return signals.rows;
    });

    return reply.status(200).send({
      success: true,
      signals: result
    });
  } catch (error: any) {
    if (error.message === 'COUPLE_NOT_FOUND') {
      return reply.status(200).send({
        success: true,
        signals: []
      });
    }

    app.log.error({ error, userId }, 'Failed to fetch pending signals');
    return sendError(reply, 500, 'PENDING_SIGNALS_FAILED', 'Failed to fetch pending signals.');
  }
};

const handleAcknowledge = async (app: FastifyInstance, request: any, reply: any) => {
  const userId = request.user?.userId;
  if (!userId) {
    app.log.info({ userId }, 'unauthorized signal acknowledge attempt');
    return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
  }

  const signalId = request.params?.id ?? request.params?.signalId;

  if (!signalId) {
    return sendError(reply, 400, 'SIGNAL_ID_REQUIRED', 'signal id is required.');
  }

  try {
    const result = await withTransaction(async (client: any) => {
      const signal = await client.query(
        `SELECT id, sender_id, recipient_id, couple_id, signal_type, delivery_status
         FROM signals
         WHERE id = $1`,
        [signalId]
      );

      if (signal.rows.length === 0) {
        throw new Error('SIGNAL_NOT_FOUND');
      }

      const signalRecord = signal.rows[0];
      const coupleCheck = await client.query(
        `SELECT id
         FROM couples
         WHERE id = $1
           AND (user1_id = $2 OR user2_id = $2)
         LIMIT 1`,
        [signalRecord.couple_id, userId]
      );

      if (signalRecord.recipient_id !== userId || coupleCheck.rows.length === 0) {
        throw new Error('UNAUTHORIZED');
      }

      await markAcknowledged(signalId);
      app.log.info({ userId, signalId, coupleId: signalRecord.couple_id }, 'signal acknowledged');

      return signalRecord;
    });

    return reply.status(200).send({ success: true });
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      return sendError(reply, 403, 'UNAUTHORIZED', 'Unauthorized.');
    }

    if (error.message === 'SIGNAL_NOT_FOUND') {
      return sendError(reply, 404, 'SIGNAL_NOT_FOUND', 'Signal not found.');
    }

    app.log.error({ error, userId, signalId }, 'Failed to acknowledge signal');
    return sendError(reply, 500, 'SIGNAL_ACKNOWLEDGE_FAILED', 'Failed to acknowledge signal.');
  }
};

export const signalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.post<{ Body: SendSignalBody }>('/signal/send', { preHandler: app.authenticate }, async (request, reply) =>
    handleSendSignal(app, request, reply)
  );

  app.post<{ Body: SendSignalBody }>('/signals/send', { preHandler: app.authenticate }, async (request, reply) =>
    handleSendSignal(app, request, reply)
  );

  app.get('/signal/pending/:coupleId', { preHandler: app.authenticate }, async (request, reply) =>
    handlePendingSignals(app, request, reply)
  );

  app.get('/signals/pending', { preHandler: app.authenticate }, async (request, reply) =>
    handlePendingSignals(app, request, reply)
  );

  app.post('/signal/:signalId/acknowledge', { preHandler: app.authenticate }, async (request, reply) =>
    handleAcknowledge(app, request, reply)
  );

  app.post('/signals/:id/ack', { preHandler: app.authenticate }, async (request, reply) =>
    handleAcknowledge(app, request, reply)
  );
};
