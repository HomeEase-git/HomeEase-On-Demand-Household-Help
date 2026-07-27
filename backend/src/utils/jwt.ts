import jwt, { Secret } from 'jsonwebtoken';
import type { JwtPayload } from '../types';

const DEFAULT_JWT_EXPIRY_SECONDS = 60 * 60 * 24 * 7;
const DEVELOPMENT_JWT_SECRET = 'homeease_development_secret_change_me';

const getJwtSecret = (): Secret => {
  const secret = process.env.JWT_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }

  return DEVELOPMENT_JWT_SECRET;
};

const getJwtExpiry = (): number => {
  const rawExpiry = process.env.JWT_EXPIRY?.trim();

  if (!rawExpiry) {
    return DEFAULT_JWT_EXPIRY_SECONDS;
  }

  const parsedExpiry = Number.parseInt(rawExpiry, 10);

  if (!Number.isFinite(parsedExpiry) || parsedExpiry <= 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_EXPIRY must be a positive number of seconds');
    }

    console.warn(
      `Invalid JWT_EXPIRY "${rawExpiry}", falling back to ${DEFAULT_JWT_EXPIRY_SECONDS} seconds`
    );
    return DEFAULT_JWT_EXPIRY_SECONDS;
  }

  return parsedExpiry;
};

const JWT_SECRET = getJwtSecret();
const JWT_EXPIRY = getJwtExpiry();

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
};

export const decodeToken = (token: string): JwtPayload | null => {
  try {
    return jwt.decode(token) as JwtPayload;
  } catch {
    return null;
  }
};
