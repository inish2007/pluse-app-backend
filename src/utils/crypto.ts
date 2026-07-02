import { randomBytes, createHash } from 'crypto';

/**
 * Generates a 256-bit (32 byte) cryptographically secure random token,
 * encoded as a hex string (64 characters long).
 */
export const generateSecureToken = (): string => {
  return randomBytes(32).toString('hex');
};

/**
 * Generates a 6-character random alphanumeric code.
 */
export const generateShortCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Generates an SHA-256 hash of a given token string for safe DB storage.
 */
export const hashToken = (token: string): string => {
  return createHash('sha256').update(token).digest('hex');
};
