import { AUTH_STORAGE_KEYS } from '../constants/index.js';

export const browserStorage = {
  getToken() {
    return localStorage.getItem(AUTH_STORAGE_KEYS.TOKEN);
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
  setSession(token, user) {
    localStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(user));
  },
  clearSession() {
    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.USER);
  },
};
