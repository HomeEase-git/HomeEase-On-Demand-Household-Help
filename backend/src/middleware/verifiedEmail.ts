import { Request, Response, NextFunction } from 'express';
import prisma from '@config/database';
import { errorResponse } from '../utils/errorResponse';

/**
 * Sign-up issues a session before the email OTP is entered (login is what
 * enforces it), so an unverified account holds a valid token. Gate the
 * onboarding actions that feed admin review behind a verified email, or a
 * worker could upload documents and submit without ever proving the address.
 * Run after authMiddleware.
 */
export const requireVerifiedEmail = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json(errorResponse(401, 'Not authenticated'));
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { isVerified: true },
    });
    if (!user?.isVerified) {
      return res.status(403).json({
        ...errorResponse(403, 'Please verify your email before continuing.'),
        code: 'EMAIL_NOT_VERIFIED',
      });
    }
  } catch (error) {
    return next(error);
  }

  return next();
};
