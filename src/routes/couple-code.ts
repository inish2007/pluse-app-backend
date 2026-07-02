import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../db/pool.js';
import { generateShortCode } from '../utils/crypto.js';
import { broadcastToUser } from '../websocket/index.js';

interface CreateCodeRequest {
  Body: object;
}

interface JoinCodeRequest {
  Params: {
    code: string;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; name?: string; email?: string };
  }
}

export const coupleCodeRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /couple/code/create - Generate a new couple code (without full invite)
  app.post<CreateCodeRequest>('/couple/code/create', async (request, reply) => {
    const userId = (request.user as any)?.id;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const result = await withTransaction(async (client: any) => {
        // Create a couple with just user1
        const coupleRes = await client.query(
          'INSERT INTO couples (user1_id) VALUES ($1) RETURNING id',
          [userId]
        );
        const coupleId = coupleRes.rows[0].id;

        // Generate a short code (no full token needed)
        let shortCode = generateShortCode();
        let attempts = 0;
        
        // Ensure uniqueness (very rare collision chance, but safe)
        while (attempts < 5) {
          const existing = await client.query(
            'SELECT id FROM invites WHERE short_code = $1 AND used = false AND expires_at > NOW()',
            [shortCode]
          );
          if (existing.rows.length === 0) break;
          shortCode = generateShortCode();
          attempts++;
        }

        // Set expiry (15 minutes)
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 15);

        // Insert minimal invite record for tracking
        await client.query(
          `INSERT INTO invites (token_hash, short_code, creator_id, couple_id, expires_at) 
           VALUES ($1, $2, $3, $4, $5)`,
          ['COUPLE_CODE_ONLY', shortCode, userId, coupleId, expiresAt.toISOString()]
        );

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
      app.log.error(error);
      return reply.status(500).send({ error: 'Failed to create couple code' });
    }
  });

  // POST /couple/code/join/:code - Join using couple code
  app.post<JoinCodeRequest>('/couple/code/join/:code', async (request, reply) => {
    const joiningUserId = (request.user as any)?.id;
    if (!joiningUserId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const code = request.params.code.toUpperCase();

    try {
      const result = await withTransaction(async (client: any) => {
        // Look up the code (must be valid and unused)
        const inviteRes = await client.query(
          `SELECT * FROM invites 
           WHERE short_code = $1 AND used = false AND expires_at > NOW() 
           FOR UPDATE`,
          [code]
        );

        if (inviteRes.rows.length === 0) {
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
          name: (request.user as any)?.name || 'Partner'
        }
      }).catch((err: any) => {
        app.log.warn('Failed to broadcast partner connection', err);
      });

      return reply.status(200).send({
        success: true,
        couple_id: result.coupleId
      });
    } catch (error: any) {
      app.log.error(error);
      const statusCode = 
        error.message === 'INVALID_OR_EXPIRED_CODE' ||
        error.message === 'COUPLE_ALREADY_FULL' ||
        error.message === 'CANNOT_JOIN_OWN_CODE' ? 400 : 500;
      
      return reply.status(statusCode).send({ 
        error: error.message || 'Failed to join couple' 
      });
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
          return { valid: false };
        }

        const invite = inviteRes.rows[0];
        const coupleRes = await client.query(
          'SELECT * FROM couples WHERE id = $1',
          [invite.couple_id]
        );

        const couple = coupleRes.rows[0];
        return {
          valid: true,
          couple_id: couple.id,
          creator_id: invite.creator_id,
          is_full: !!couple.user2_id
        };
      });

      return reply.send(result);
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Validation failed' });
    }
  });
};
