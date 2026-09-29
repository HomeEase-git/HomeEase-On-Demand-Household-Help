import { Request, Response, NextFunction } from 'express';
import { raiseSecurityAlert } from '@services/securityAlertService';
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
      // Neither app ever calls an admin-only route as a client or worker, so
      // this is someone exploring the API with a real account's token.
      if (allowedRoles.length === 1 && allowedRoles[0] === 'ADMIN') {
        void raiseSecurityAlert({
          type: 'ADMIN_ROUTE_DENIED',
          severity: 'medium',
          message: `A ${req.user.role.toLowerCase()} account (${req.user.email}) tried the admin-only endpoint ${req.method} ${req.originalUrl.split('?')[0]}.`,
          actor: { id: req.user.userId, email: req.user.email, role: req.user.role },
          throttleKey: req.user.userId,
        }).catch((error) => console.error('Security alert failed:', error));
      }
      return res.status(403).json(errorResponse(403, `Only ${allowedRoles.join(' or ')} users can access this resource`));
    }

    return next();
  };
};