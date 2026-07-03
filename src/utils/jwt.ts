import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

export interface JwtPayload {
  id: string;
  email: string;
  name?: string;
  iat: number;
  exp: number;
}

export interface BackendJwtPayload {
  userId: string;
  firebaseUid: string;
  coupleId: string | null;
  iat: number;
  exp: number;
}

export class JwtVerificationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = 'JwtVerificationError';
  }
}

export const getJwtSecret = (): string => {
  if (!JWT_SECRET) {
    throw new JwtVerificationError('JWT secret is not configured', 500);
  }

  return JWT_SECRET;
};

export const parseBearerToken = (authorizationHeader: string | undefined): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (scheme !== 'Bearer' || !token || rest.length > 0) {
    return null;
  }

  return token;
};

export const verifyBackendJwt = (token: string): BackendJwtPayload => {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as BackendJwtPayload;

    if (
      !decoded ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.firebaseUid !== 'string' ||
      (decoded.coupleId !== null && typeof decoded.coupleId !== 'string')
    ) {
      throw new JwtVerificationError('Invalid token payload');
    }

    return decoded;
  } catch (error) {
    if (error instanceof JwtVerificationError) {
      throw error;
    }

    if (error instanceof jwt.TokenExpiredError) {
      throw new JwtVerificationError('Token expired');
    }

    if (error instanceof jwt.JsonWebTokenError) {
      throw new JwtVerificationError('Invalid token');
    }

    throw new JwtVerificationError('Unauthorized');
  }
};

/**
 * Verify and decode a JWT token
 */
export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload;
    return decoded;
  } catch (error) {
    return null;
  }
};

/**
 * Generate a backend JWT token for application authentication.
 */
export const generateBackendToken = (payload: {
  userId: string;
  firebaseUid: string;
  coupleId: string | null;
}): string => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' }) as string;
};

/**
 * Generate a legacy token for WebSocket or other existing flows.
 */
export const generateToken = (userId: string, email: string, name?: string): string => {
  return jwt.sign(
    {
      id: userId,
      email,
      name: name || email.split('@')[0]
    },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
};
