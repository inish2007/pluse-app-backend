import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../db/pool.js';
import { generateSecureToken, generateShortCode, hashToken } from '../utils/crypto.js';
import { broadcastToUser } from '../websocket/index.js';

interface CreateCodeRequest {
  Body: object;
}

interface JoinCodeRequest {
  Params: {
    code: string;
  };
}

const sendError = (
  reply: any,
  statusCode: number,
  code: string,
  message: string
) => {
  return reply.status(statusCode).send({
    success: false,
    code,
    message
  });
};

export const coupleCodeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /couple/code/create - Generate a new couple code (without full invite)
  app.post<CreateCodeRequest>('/couple/code/create', async (request, reply) => {
    const userId = request.user?.userId;
    if (!userId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
    }

    try {
      const result = await withTransaction(async (client: any) => {
        const existingCoupleRes = await client.query(
          `SELECT id FROM couples
           WHERE user1_id = $1 OR user2_id = $1
           LIMIT 1`,
          [userId]
        );

        if (existingCoupleRes.rows.length > 0) {
          throw new Error('COUPLE_ALREADY_EXISTS');
        }

        // Create a couple with just user1
        const coupleRes = await client.query(
          'INSERT INTO couples (user1_id) VALUES ($1) RETURNING id',
          [userId]
        );
        const coupleId = coupleRes.rows[0].id;

        // Generate a short code (no full token needed)
        let shortCode = generateShortCode();

        // Keep retrying until the generated code is unique.
        // Collision probability is extremely low, but this makes the flow robust.
        while (true) {
          const existing = await client.query(
            'SELECT id FROM invites WHERE short_code = $1 AND used = false AND expires_at > NOW()',
            [shortCode]
          );

          if (existing.rows.length === 0) {
            break;
          }

          shortCode = generateShortCode();
        }

        // Set expiry (15 minutes)
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 15);

        // Insert minimal invite record for tracking
        const tokenHash = hashToken(generateSecureToken());

        await client.query(
          `INSERT INTO invites (token_hash, short_code, creator_id, couple_id, expires_at) 
           VALUES ($1, $2, $3, $4, $5)`,
          [tokenHash, shortCode, userId, coupleId, expiresAt.toISOString()]
        );

        app.log.info({ userId, coupleId }, 'couple created');
        app.log.info({ userId, coupleId, shortCode }, 'code generated');

        return {
          coupleId,
          code: shortCode,
          expiresAt: expiresAt.toISOString()
        };
      });

      return reply.status(201).send({
        success: true,
        code: result.code,
        couple_id: result.coupleId,
        expires_at: result.expiresAt
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'COUPLE_ALREADY_EXISTS') {
        app.log.info({ userId }, 'duplicate couple creation attempt');
        return sendError(reply, 409, 'COUPLE_ALREADY_EXISTS', 'User is already paired.');
      }

      app.log.error({ error, userId }, 'Failed to create couple code');
      return sendError(reply, 500, 'COUPLE_CODE_CREATE_FAILED', 'Failed to create couple code.');
    }
  });

  // POST /couple/code/join/:code - Join using couple code
  app.post<JoinCodeRequest>('/couple/code/join/:code', async (request, reply) => {
    const joiningUserId = request.user?.userId;
    if (!joiningUserId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
    }

    const code = request.params.code.toUpperCase();

    try {
      const result = await withTransaction(async (client: any) => {
        const existingCoupleRes = await client.query(
          `SELECT id FROM couples
           WHERE user1_id = $1 OR user2_id = $1
           LIMIT 1`,
          [joiningUserId]
        );

        if (existingCoupleRes.rows.length > 0) {
          throw new Error('COUPLE_ALREADY_EXISTS');
        }

        // Look up the code (must be valid and unused)
        const inviteRes = await client.query(
          `SELECT * FROM invites 
           WHERE short_code = $1 AND used = false AND expires_at > NOW() 
           FOR UPDATE`,
          [code]
        );

        if (inviteRes.rows.length === 0) {
          app.log.info({ code }, 'invalid code');
          throw new Error('INVALID_OR_EXPIRED_CODE');
        }

        const invite = inviteRes.rows[0];

        // Get couple record
        const coupleRes = await client.query(
          'SELECT * FROM couples WHERE id = $1 FOR UPDATE',
          [invite.couple_id]
        );

        const couple = coupleRes.rows[0];
        if (!couple) {
          throw new Error('COUPLE_NOT_FOUND');
        }

        if (couple.user2_id) {
          throw new Error('COUPLE_ALREADY_FULL');
        }

        if (couple.user1_id === joiningUserId) {
          throw new Error('CANNOT_JOIN_OWN_CODE');
        }

        // Update couple with second user
        await client.query(
          'UPDATE couples SET user2_id = $1, updated_at = NOW() WHERE id = $2',
          [joiningUserId, couple.id]
        );

        // Mark code as used
        await client.query(
          'UPDATE invites SET used = true WHERE id = $1',
          [invite.id]
        );

        app.log.info({ joiningUserId, coupleId: couple.id }, 'join successful');

        return {
          coupleId: couple.id,
          user1Id: couple.user1_id,
          joiningUserId
        };
      });

      // After successful join, notify partner via WebSocket/FCM
      broadcastToUser(result.user1Id, {
        type: 'PARTNER_CONNECTED',
        partner: {
          id: result.joiningUserId,
          name: 'Partner'
        }
      }).catch((err: any) => {
        app.log.warn('Failed to broadcast partner connection', err);
      });

      return reply.status(200).send({
        success: true,
        couple_id: result.coupleId
      });
    } catch (error: any) {
      if (error.message === 'COUPLE_ALREADY_EXISTS') {
        app.log.info({ joiningUserId }, 'duplicate join attempt');
        return sendError(reply, 409, 'COUPLE_ALREADY_EXISTS', 'User is already paired.');
      }

      if (error.message === 'INVALID_OR_EXPIRED_CODE') {
        return sendError(reply, 400, 'INVALID_OR_EXPIRED_CODE', 'Invalid or expired code.');
      }

      if (error.message === 'COUPLE_ALREADY_FULL') {
        return sendError(reply, 400, 'COUPLE_ALREADY_FULL', 'Couple is already full.');
      }

      if (error.message === 'CANNOT_JOIN_OWN_CODE') {
        return sendError(reply, 400, 'CANNOT_JOIN_OWN_CODE', 'You cannot join your own code.');
      }

      app.log.error({ error, joiningUserId }, 'Failed to join couple');
      return sendError(reply, 500, 'COUPLE_CODE_JOIN_FAILED', 'Failed to join couple.');
    }
  });

  // GET /couple/code/validate/:code - Check if code is valid (no pairing)
  app.get<JoinCodeRequest>('/couple/code/validate/:code', async (request, reply) => {
    const code = request.params.code.toUpperCase();

    try {
      const result = await withTransaction(async (client: any) => {
        const inviteRes = await client.query(
          `SELECT * FROM invites 
           WHERE short_code = $1 AND used = false AND expires_at > NOW()`,
          [code]
        );

        if (inviteRes.rows.length === 0) {
          app.log.info({ code }, 'invalid code');
          return { valid: false };
        }

        const invite = inviteRes.rows[0];
        const coupleRes = await client.query(
          'SELECT user2_id FROM couples WHERE id = $1',
          [invite.couple_id]
        );

        const couple = coupleRes.rows[0];
        return {
          valid: true,
          expires_at: invite.expires_at,
          is_full: !!couple.user2_id
        };
      });

      return reply.send(result);
    } catch (error) {
      app.log.error({ error }, 'Validation failed');
      return sendError(reply, 500, 'COUPLE_CODE_VALIDATE_FAILED', 'Validation failed.');
    }
  });
};
