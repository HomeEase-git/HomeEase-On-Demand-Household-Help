import { createApiClient, browserStorage } from '@shared/api-client/index.js';

const client = createApiClient({
  getBaseUrl: () => import.meta.env.VITE_API_URL || '/api',
  storage: browserStorage,
});

export const {
  apiRequest,
  getStoredToken,
  getStoredUser,
  setAuthSession,
  clearAuthSession,
  login: loginUser,
  fetchCurrentUser,
  logout: clearSession,
} = client;
