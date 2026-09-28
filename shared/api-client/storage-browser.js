import { AUTH_STORAGE_KEYS } from '../constants/index.js';

export const browserStorage = {
  getToken() {
    return localStorage.getItem(AUTH_STORAGE_KEYS.TOKEN);
  },
  getRefreshToken() {
    return localStorage.getItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
  },
  // After a refresh: new token pair, same user.
  setTokens(token, refreshToken) {
    localStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
  },
  getUser() {
    const raw = localStorage.getItem(AUTH_STORAGE_KEYS.USER);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  setSession(token, user, refreshToken) {
    localStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(user));
    if (refreshToken) localStorage.setItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
  },
  clearSession() {
    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
    localStorage.removeItem(AUTH_STORAGE_KEYS.REFRESH_TOKEN);
  },
};
