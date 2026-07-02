import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

export interface JwtPayload {
  id: string;
  email: string;
  name?: string;
  iat: number;
  exp: number;
}

/**
 * Verify and decode a JWT token
 */
export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch (error) {
    return null;
  }
};

/**
 * Generate a JWT token
 */
export const generateToken = (userId: string, email: string, name?: string): string => {
  return jwt.sign(
    {
      id: userId,
      email,
      name: name || email.split('@')[0]
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};
