import { randomInt } from 'crypto';

const PERSONAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const generatePersonalCode = (length = 8): string => {
  const normalizedLength = Math.max(6, Math.min(8, Math.floor(length)));
  let code = '';

  for (let i = 0; i < normalizedLength; i++) {
    code += PERSONAL_CODE_ALPHABET.charAt(randomInt(PERSONAL_CODE_ALPHABET.length));
  }

  return code;
};
