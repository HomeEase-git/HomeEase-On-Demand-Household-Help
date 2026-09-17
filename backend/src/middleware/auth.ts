import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@utils/jwt';
import { isUserSessionRevoked } from '@utils/tokenRevocation';
import type { JwtPayload } from '../types';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'No token provided',
      });
      return;
    }

    const decoded = verifyToken(token);

    // A challenge token minted mid-login for an MFA-enabled admin (see
    // authController.login/mfaChallenge) is not a session — it exists only
    // to be handed to POST /auth/mfa/challenge. Reject it here so a leaked
    // challenge token can't be replayed against any protected route.
    if (decoded.type === 'mfa_pending') {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
      return;
    }

    // Banned/suspended users otherwise keep a valid-looking access token
    // for up to JWT_EXPIRY (7 days by default) — this is what makes a ban
    // actually take effect immediately. See
    // adminUserController.setUserStatus / utils/tokenRevocation.ts. Fails
    // open (never blocks a request) if Redis itself is unreachable.
    if (await isUserSessionRevoked(decoded.userId)) {
      res.status(401).json({
        success: false,
        message: 'Your session has been revoked',
      });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
    return;
  }
};
