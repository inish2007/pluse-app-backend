import { pool } from './pool.js';
import { generatePersonalCode } from '../utils/code.js';

export interface DbUser {
  id: string;
  firebase_uid: string;
  personal_code: string | null;
  name: string;
  email: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface DbCouple {
  id: string;
  user1_id: string;
  user2_id: string | null;
  created_at: string;
  updated_at: string;
}

const generateUniquePersonalCode = async (): Promise<string> => {
  while (true) {
    const candidate = generatePersonalCode();
    const existing = await pool.query<{ id: string }>(
      'SELECT id FROM users WHERE personal_code = $1 LIMIT 1',
      [candidate]
    );

    if (existing.rows.length === 0) {
      return candidate;
    }
  }
};

export const upsertFirebaseUser = async (
  firebaseUid: string,
  email: string,
  displayName: string
): Promise<DbUser> => {
  const normalizedName = displayName.trim() || email;

  const existingUser = await pool.query<DbUser>(
    `SELECT id, firebase_uid, personal_code, name, email, last_seen_at, created_at, updated_at
     FROM users
     WHERE firebase_uid = $1
     LIMIT 1`,
    [firebaseUid]
  );

  if (existingUser.rows[0]) {
    const result = await pool.query<DbUser>(
      `UPDATE users
       SET email = COALESCE($2, email),
           name = COALESCE(NULLIF($3, ''), name),
           updated_at = NOW()
       WHERE firebase_uid = $1
       RETURNING id, firebase_uid, personal_code, name, email, last_seen_at, created_at, updated_at`,
      [firebaseUid, email, normalizedName]
    );

    if (!result.rows[0]) {
      throw new Error('Failed to upsert Firebase user');
    }

    return result.rows[0];
  }

  for (let attempt = 0; attempt < 25; attempt++) {
    const personalCode = await generateUniquePersonalCode();

    try {
      const result = await pool.query<DbUser>(
        `INSERT INTO users (firebase_uid, personal_code, email, name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         RETURNING id, firebase_uid, personal_code, name, email, last_seen_at, created_at, updated_at`,
        [firebaseUid, personalCode, email, normalizedName]
      );

      if (!result.rows[0]) {
        throw new Error('Failed to upsert Firebase user');
      }

      return result.rows[0];
    } catch (error: any) {
      if (error?.code === '23505') {
        continue;
      }

      throw error;
    }
  }

  throw new Error('Failed to generate unique personal code');
};

export const findCurrentCoupleId = async (userId: string): Promise<string | null> => {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM couples WHERE user1_id = $1 OR user2_id = $1 LIMIT 1`,
    [userId]
  );

  return result.rows[0]?.id ?? null;
};

export const getUserPersonalCode = async (userId: string): Promise<string | null> => {
  const result = await pool.query<{ personal_code: string | null }>(
    `SELECT personal_code
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0]?.personal_code ?? null;
};

export const findUserByPersonalCode = async (personalCode: string): Promise<DbUser | null> => {
  const result = await pool.query<DbUser>(
    `SELECT id, firebase_uid, personal_code, name, email, last_seen_at, created_at, updated_at
     FROM users
     WHERE personal_code = $1
     LIMIT 1`,
    [personalCode]
  );

  return result.rows[0] ?? null;
};

export const findUserById = async (userId: string): Promise<DbUser | null> => {
  const result = await pool.query<DbUser>(
    `SELECT id, firebase_uid, personal_code, name, email, last_seen_at, created_at, updated_at
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
};

export const isUserAlreadyPaired = async (userId: string): Promise<boolean> => {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM couples
     WHERE user1_id = $1 OR user2_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows.length > 0;
};

export const createCouple = async (user1Id: string, user2Id: string): Promise<string> => {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO couples (user1_id, user2_id)
     VALUES ($1, $2)
     RETURNING id`,
    [user1Id, user2Id]
  );

  if (!result.rows[0]) {
    throw new Error('Failed to create couple');
  }

  return result.rows[0].id;
};

export const findCoupleByUser = async (userId: string): Promise<DbCouple | null> => {
  const result = await pool.query<DbCouple>(
    `SELECT id, user1_id, user2_id, created_at, updated_at
     FROM couples
     WHERE user1_id = $1 OR user2_id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
};

export const deleteCouple = async (coupleId: string): Promise<void> => {
  await pool.query('DELETE FROM couples WHERE id = $1', [coupleId]);
};

export const updateUserLastSeen = async (userId: string): Promise<void> => {
  await pool.query(
    `UPDATE users
     SET last_seen_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );
};
