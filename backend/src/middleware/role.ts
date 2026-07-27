import { Request, Response, NextFunction } from 'express';
import { errorResponse } from '../utils/errorResponse';

/**
 * Restrict endpoint access to specific roles.
 * Usage: router.patch('/me/availability', restrictTo('WORKER'), updateAvailability);
 */
export const restrictTo = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json(errorResponse(401, 'Not authenticated'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json(errorResponse(403, `Only ${allowedRoles.join(' or ')} users can access this resource`));
    }

    return next();
  };
};