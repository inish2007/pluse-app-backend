import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { withTransaction } from '../db/pool.js';
import { hashToken } from '../utils/crypto.js';
import { broadcastToUser } from '../websocket/index.js'; // TBD

interface JoinRequest {
  Params: {
    token: string;
  };
}

export const joinRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // POST /couple/join/:token
  app.post<JoinRequest>('/couple/join/:token', {
  }, async (request, reply) => {
    // Current joining user ID
    const joiningUserId = request.user?.userId || '11111111-1111-1111-1111-111111111111'; // Mock Auth ID
    const rawToken = request.params.token;

    // If it's a 6-character code, search by short_code. Otherwise, hash it.
    let tokenHash = null;
    let shortCode = null;
    if (rawToken.length === 6) {
      shortCode = rawToken.toUpperCase();
    } else {
      tokenHash = hashToken(rawToken);
    }

    try {
      const result = await withTransaction(async (client: any) => {
        // 1. Lock the invite row safely to prevent simultaneous uses (idempotency/replay stop)
        const inviteRes = await client.query(
          `SELECT * FROM invites WHERE (token_hash = $1 OR short_code = $2) AND used = false AND expires_at > NOW() FOR UPDATE`,
          [tokenHash, shortCode]
        );

        if (inviteRes.rows.length === 0) {
          throw new Error('INVALID_OR_EXPIRED_INVITE');
        }

        const invite = inviteRes.rows[0];

        // 2. Lock the couple row
        const coupleRes = await client.query(
          `SELECT * FROM couples WHERE id = $1 FOR UPDATE`,
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
           throw new Error('CANNOT_JOIN_OWN_INVITE');
        }

        // 3. Update the couple to set user2_id
        await client.query(
          `UPDATE couples SET user2_id = $1, updated_at = NOW() WHERE id = $2`,
          [joiningUserId, couple.id]
        );

        // 4. Mark invite as used
        await client.query(
          `UPDATE invites SET used = true WHERE id = $1`,
          [invite.id]
        );

        return { coupleId: couple.id, user1Id: couple.user1_id };
      });

      // 5. Success! Emit WebSocket event to user1
      broadcastToUser(result.user1Id, {
        type: 'PARTNER_CONNECTED',
        partner: {
          id: joiningUserId,
          name: 'Partner'
        }
      }).catch(err => {
        app.log.warn('Failed to broadcast partner connection', err);
      });

      return reply.status(200).send({ success: true, couple_id: result.coupleId });

    } catch (error: any) {
      app.log.error(error);
      const code = error.message === 'INVALID_OR_EXPIRED_INVITE' || error.message === 'COUPLE_ALREADY_FULL' || error.message === 'CANNOT_JOIN_OWN_INVITE' ? 400 : 500;
      return reply.status(code).send({ error: error.message || 'Internal Server Error' });
    }
  });
};
