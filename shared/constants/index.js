export const ROLES = {
  CLIENT: 'CLIENT',
  WORKER: 'WORKER',
  ADMIN: 'ADMIN',
};

export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  PENDING: 'PENDING',
};

export const VERIFICATION_STATUS = {
  PENDING: 'PENDING',
  AI_REVIEWED: 'AI_REVIEWED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

export const AUTH_STORAGE_KEYS = {
  TOKEN: 'homeease_token',
  USER: 'homeease_user',
};

export const API_PATHS = {
  AUTH_LOGIN: '/auth/login',
  AUTH_SIGNUP: '/auth/signup',
  AUTH_ME: '/auth/me',
  VERIFICATION_UPLOAD: '/verification/upload',
  VERIFICATION_MINE: '/verification/mine',
  ADMIN_VERIFICATIONS: '/admin/verifications',
};
