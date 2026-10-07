import { Request, Response, NextFunction } from 'express';
import prisma from '@config/database';
import { raiseSecurityAlert } from '@services/securityAlertService';
import { errorResponse } from '../utils/errorResponse';

// Only the jest suite may switch this off (tests/setupEnv.ts): its admin
// fixtures sign in with a password alone. Any other NODE_ENV ignores the flag.
function adminMfaEnforced(): boolean {
  return !(process.env.NODE_ENV === 'test' && process.env.ADMIN_MFA_ENFORCEMENT === 'off');
}

/**
 * An admin without MFA still gets a session (so they can reach the setup
 * screen — hard-blocking login was rejected as a first-admin lockout risk),
 * but that session must not open admin-only routes: mfaSetupRequired in the
 * login response is only a hint the client can ignore.
 */
async function adminHasMfa(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } });
  return user?.mfaEnabled === true;
}

/**
 * Restrict endpoint access to specific roles.
 * Usage: router.patch('/me/availability', restrictTo('WORKER'), updateAvailability);
 */
export const restrictTo = (...allowedRoles: string[]) => roleGuard(allowedRoles, true);

/** Admin-only, but open to an admin who hasn't set up MFA yet — for the MFA setup routes themselves. */
export const restrictToAdminSettingUpMfa = () => roleGuard(['ADMIN'], false);

function roleGuard(allowedRoles: string[], requireAdminMfa: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
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

    const adminOnly = allowedRoles.length === 1 && allowedRoles[0] === 'ADMIN';
    if (requireAdminMfa && adminOnly && adminMfaEnforced()) {
      try {
        if (!(await adminHasMfa(req.user.userId))) {
          return res.status(403).json({
            ...errorResponse(403, 'Set up two-factor authentication before using the admin dashboard.'),
            code: 'ADMIN_MFA_REQUIRED',
          });
        }
      } catch (error) {
        return next(error);
      }
    }

    return next();
  };
}