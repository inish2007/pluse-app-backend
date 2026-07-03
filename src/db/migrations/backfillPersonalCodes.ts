import { pool } from '../pool.js';
import { generatePersonalCode } from '../../utils/code.js';

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

export const backfillPersonalCodes = async (): Promise<number> => {
  const pendingUsers = await pool.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE personal_code IS NULL
     ORDER BY created_at ASC`
  );

  let updatedCount = 0;

  for (const user of pendingUsers.rows) {
    while (true) {
      const personalCode = await generateUniquePersonalCode();

      const result = await pool.query(
        `UPDATE users
         SET personal_code = $1,
             updated_at = NOW()
         WHERE id = $2
           AND personal_code IS NULL`,
        [personalCode, user.id]
      );

      if (result.rowCount === 1) {
        updatedCount++;
        break;
      }

      const refreshed = await pool.query<{ id: string }>(
        'SELECT id FROM users WHERE id = $1 AND personal_code IS NULL LIMIT 1',
        [user.id]
      );

      if (refreshed.rows.length === 0) {
        break;
      }
    }
  }

  console.log(`Backfilled personal codes for ${updatedCount} users`);
  return updatedCount;
};

// Once every existing user has a personal_code, the schema can later be tightened to:
// ALTER TABLE users ALTER COLUMN personal_code SET NOT NULL;
