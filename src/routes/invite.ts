import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { generateSecureToken, generateShortCode, hashToken } from '../utils/crypto.js';

// Type definitions for the route
interface InviteRequest {
  Body: {
    // Other payload data if needed
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

export const inviteRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /couple/invite
  app.post<InviteRequest>(
    '/couple/invite',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return sendError(reply, 401, 'UNAUTHORIZED', 'Unauthorized.');
      }

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 15);

      const generateUniqueShortCode = async (client: any): Promise<string> => {
        while (true) {
          const candidate = generateShortCode();
          const existing = await client.query(
            'SELECT 1 FROM invites WHERE short_code = $1 LIMIT 1',
            [candidate]
          );

          if (existing.rows.length === 0) {
            return candidate;
          }
        }
      };

      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const coupleCheck = await client.query(
            `SELECT id FROM couples
             WHERE user1_id = $1 OR user2_id = $1
             LIMIT 1`,
            [userId]
          );

          if (coupleCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            app.log.info({ userId }, 'duplicate invite attempt');
            return sendError(reply, 409, 'COUPLE_ALREADY_EXISTS', 'User is already paired.');
          }

          const existingInviteRes = await client.query(
            `SELECT id, token_hash, short_code, expires_at, couple_id
             FROM invites
             WHERE creator_id = $1
               AND used = false
               AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1
             FOR UPDATE`,
            [userId]
          );

          if (existingInviteRes.rows.length > 0) {
            const existingInvite = existingInviteRes.rows[0];
            const tokenHash = existingInvite.token_hash as string;
            const shortCode = existingInvite.short_code as string;
            const rawToken = generateSecureToken();

            await client.query('COMMIT');

            app.log.info({ userId, coupleId: existingInvite.couple_id }, 'invite reused');

            return reply.status(200).send({
              success: true,
              link: `https://pulse.app/invite/${rawToken}`,
              code: shortCode,
              expires_at: existingInvite.expires_at
            });
          }

          const coupleRes = await client.query(
            'INSERT INTO couples (user1_id) VALUES ($1) RETURNING id',
            [userId]
          );
          const coupleId = coupleRes.rows[0].id as string;

          const rawToken = generateSecureToken();
          const tokenHash = hashToken(rawToken);
          const shortCode = await generateUniqueShortCode(client);

          await client.query(
            `INSERT INTO invites (token_hash, short_code, creator_id, couple_id, expires_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [tokenHash, shortCode, userId, coupleId, expiresAt.toISOString()]
          );

          await client.query('COMMIT');

          app.log.info({ userId, coupleId }, 'invite created');
          app.log.info({ userId, coupleId }, 'code generated');

          return reply.status(201).send({
            success: true,
            link: `https://pulse.app/invite/${rawToken}`,
            code: shortCode,
            expires_at: expiresAt.toISOString()
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      } catch (error) {
        app.log.error({ error, userId }, 'Invite generation failed');
        return sendError(reply, 500, 'INVITE_GENERATION_FAILED', 'Failed to generate invite.');
      }
    }
  );
};
