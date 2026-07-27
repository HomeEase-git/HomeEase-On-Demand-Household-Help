import { loginUser, fetchCurrentUser, clearSession, setAuthSession } from './apiClient';
import { ROLES } from '@shared/constants/index.js';

const DUMMY_ADMIN_EMAIL = 'admin@homeeaseadmin.com';
const DUMMY_ADMIN_PASSWORD = 'Admin1234';
const DUMMY_ADMIN_TOKEN = 'dummy-admin-token';

export async function login(email, password) {
  const useDummyAdmin = import.meta.env.DEV;

  if (useDummyAdmin && email.trim().toLowerCase() === DUMMY_ADMIN_EMAIL && password === DUMMY_ADMIN_PASSWORD) {
    const dummyUser = {
      id: 'dummy-admin-id',
      name: 'HomeEase Admin',
      email: DUMMY_ADMIN_EMAIL,
      phone: '+639171234567',
      role: ROLES.ADMIN,
    };

    setAuthSession(DUMMY_ADMIN_TOKEN, dummyUser);
    return {
      ...dummyUser,
      token: DUMMY_ADMIN_TOKEN,
    };
  }

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
