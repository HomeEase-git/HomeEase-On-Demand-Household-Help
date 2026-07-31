import { loginUser, fetchCurrentUser, clearSession, setAuthSession } from './apiClient';
import { ROLES } from '@shared/constants/index.js';

export async function login(email, password) {
  const user = await loginUser(email, password);

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
