import { loginUser, mfaChallengeRequest, fetchCurrentUser, clearSession, setAuthSession } from './apiClient';
import { ROLES } from '@shared/constants/index.js';

export async function login(email, password) {
  const user = await loginUser(email, password);

  // MFA-enabled admin — no session yet, just a challenge to complete. Let
  // the caller (Login.jsx) show the code-entry step; nothing to validate
  // or store until completeMfaChallenge succeeds.
  if (user.mfaRequired) {
    return user;
  }

  if (user.role !== ROLES.ADMIN) {
    clearSession();
    throw new Error('Admin access only. This account cannot access the admin dashboard.');
  }

  setAuthSession(user.token, {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  });

  return user;
}

export async function completeMfaChallenge(challengeToken, code) {
  const user = await mfaChallengeRequest(challengeToken, code);

  if (user.role !== ROLES.ADMIN) {
    clearSession();
    throw new Error('Admin access only. This account cannot access the admin dashboard.');
  }

  setAuthSession(user.token, {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  });

  return user;
}

export { fetchCurrentUser };

export function logout() {
  clearSession();
}
