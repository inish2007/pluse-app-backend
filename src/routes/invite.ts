import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { pool } from '../db/pool.js';
import { generateSecureToken, generateShortCode, hashToken } from '../utils/crypto.js';

// Type definitions for the route
interface InviteRequest {
  Body: {
    // Other payload data if needed
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; name?: string; email?: string };
  }
}

export const inviteRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /couple/invite
  app.post<InviteRequest>('/couple/invite', {
    // Add schema validation later if needed
    // preHandler: [app.authenticate] // Assuming authenticate plugin exists
  }, async (request, reply) => {
    // Simulate current user context extracted from JWT (hardcoded for now to assume user exists)
    const userId = (request.user as any)?.id || '00000000-0000-0000-0000-000000000000'; // Replace with real Auth

    // 1. Generate token, code, and hash
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);
    const shortCode = generateShortCode();

    // 2. Set expiry (15 minutes)
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const coupleRes = await client.query(
          'INSERT INTO couples (user1_id) VALUES ($1) RETURNING id',
          [userId]
        );
        const coupleId = coupleRes.rows[0].id;

        // Insert the unique invite hash AND short code
        await client.query(
          'INSERT INTO invites (token_hash, short_code, creator_id, couple_id, expires_at) VALUES ($1, $2, $3, $4, $5)',
          [tokenHash, shortCode, userId, coupleId, expiresAt.toISOString()]
        );
        
        await client.query('COMMIT');

        return reply.status(201).send({
          success: true,
          link: `https://pulse.app/invite/${rawToken}`,
          code: shortCode,
          expires_at: expiresAt
        });

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Failed to generate invite' });
    }
  });
};
