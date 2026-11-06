import { Request, Response, NextFunction } from 'express';
import { setRequestUser } from '@utils/requestContext';
import { verifyToken } from '@utils/jwt';
import { isUserSessionRevoked, isSessionRevoked } from '@utils/tokenRevocation';
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

    if (decoded.type === 'mfa_pending' || decoded.type === 'otp_pending') {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
      return;
    }

    if ((await isUserSessionRevoked(decoded.userId)) || (decoded.sid && (await isSessionRevoked(decoded.sid)))) {
      res.status(401).json({
        success: false,
        message: 'Your session has been revoked',
      });
      return;
    }

    req.user = decoded;
    setRequestUser(decoded.userId);
    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
    return;
  }
};
