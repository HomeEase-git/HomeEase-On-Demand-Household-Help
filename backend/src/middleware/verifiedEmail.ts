import { Request, Response, NextFunction } from 'express';
import prisma from '@config/database';
import { errorResponse } from '../utils/errorResponse';

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
