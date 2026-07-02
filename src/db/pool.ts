import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

dotenv.config();

// PostgreSQL connection pool
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pulse',
  // Configure pool constraints for scalability
  max: 20, // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Helper for running transactions
export const withTransaction = async <T>(callback: (client: any) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const initializeDatabase = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
    const schemaSql = await readFile(schemaPath, 'utf8');
    await client.query(schemaSql);
  } finally {
    client.release();
  }
};
