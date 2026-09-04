import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  AUTH_TOKEN: '@homeease_auth_token',
  AUTH_USER: '@homeease_auth_user',
  BOOKING_DRAFT: '@homeease_booking_draft',
  SEARCH_HISTORY: '@homeease_search_history',
  ADDRESSES: '@homeease_addresses',
  CERTIFICATIONS: '@homeease_certifications',
  PAYMENT_METHODS: '@homeease_payment_methods',
  SKILLS: '@homeease_skills',
  PROFILE: '@homeease_profile',
  PRIVACY_SETTINGS: '@homeease_privacy_settings',
};

const memoryStore: Record<string, unknown> = {};

const readStoredValue = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const data = await AsyncStorage.getItem(key);
    if (data) {
      return JSON.parse(data) as T;
    }
    return (memoryStore[key] as T | undefined) ?? fallback;
  } catch (error) {
    console.error(`Error reading storage key ${key}:`, error);
    return (memoryStore[key] as T | undefined) ?? fallback;
  }
};

const writeStoredValue = async (key: string, value: unknown) => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error writing storage key ${key}:`, error);
  }
  memoryStore[key] = value;
};

// In-memory cache for the auth token specifically — it's read by the API
// client's request interceptor on every single network call (~60+ call
// sites), so a per-call AsyncStorage round-trip there is a real, constant
// tax on every screen. `undefined` = not loaded yet from disk this session;
// `null` = loaded, no token. Kept in sync by saveToken/clearAuth below.
let cachedToken: string | null | undefined;

// Auth Storage
export const authStorage = {
  async saveToken(token: string) {
    cachedToken = token;
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
      cachedToken = token;
    } catch (error) {
      console.error('Error saving auth token:', error);
    }
  },

  async getToken() {
    if (cachedToken !== undefined) {
      return cachedToken;
    }
    try {
      const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      cachedToken = token;
      return token;
    } catch (error) {
      console.error('Error reading auth token:', error);
      return null;
    }
  },

  async saveUser(user: any) {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));
    } catch (error) {
      console.error('Error saving user:', error);
    }
  },

  async getUser() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_USER);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error reading user:', error);
      return null;
    }
  },

  async clearAuth() {
    cachedToken = null;
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_USER);
      cachedToken = null;
    } catch (error) {
      console.error('Error clearing auth:', error);
    }
  },
};

// Booking Draft Storage
export const bookingStorage = {
  async saveDraft(draft: any) {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.BOOKING_DRAFT, JSON.stringify(draft));
    } catch (error) {
      console.error('Error saving booking draft:', error);
    }
  },

  async getDraft() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.BOOKING_DRAFT);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Error reading booking draft:', error);
      return null;
    }
  },

  async clearDraft() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.BOOKING_DRAFT);
    } catch (error) {
      console.error('Error clearing booking draft:', error);
    }
  },
};

// Search History Storage
export const searchStorage = {
  async saveSearches(searches: string[]) {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.SEARCH_HISTORY, JSON.stringify(searches));
    } catch (error) {
      console.error('Error saving search history:', error);
    }
  },

  async getSearches() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SEARCH_HISTORY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error reading search history:', error);
      return [];
    }
  },

  async clearSearches() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.SEARCH_HISTORY);
    } catch (error) {
      console.error('Error clearing search history:', error);
    }
  },
};

export const addressStorage = {
  async list() {
    return readStoredValue(STORAGE_KEYS.ADDRESSES, [] as any[]);
  },

  async get(id: string) {
    try {
      const addresses = await this.list();
      return addresses.find((item: any) => item.id === id) ?? null;
    } catch (error) {
      console.error('Error reading address:', error);
      return null;
    }
  },

  async create(payload: { label: string; address: string; lat?: number; lng?: number; isDefault?: boolean }) {
    try {
      const addresses = await this.list();
      const item = {
        id: `addr-${Date.now()}`,
        ...payload,
        isDefault: payload.isDefault ?? false,
        createdAt: new Date().toISOString(),
      };
      const next = [...addresses, item];
      await writeStoredValue(STORAGE_KEYS.ADDRESSES, next);
      return item;
    } catch (error) {
      console.error('Error creating address:', error);
      return null;
    }
  },

  async update(id: string, updates: Partial<{ label: string; address: string; lat: number; lng: number; isDefault: boolean }>) {
    try {
      const addresses = await this.list();
      const next = addresses.map((item: any) =>
        item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item,
      );
      await writeStoredValue(STORAGE_KEYS.ADDRESSES, next);
      return next.find((item: any) => item.id === id) ?? null;
    } catch (error) {
      console.error('Error updating address:', error);
      return null;
    }
  },

  // Writes/merges an entry keyed by an externally-supplied id (the real
  // backend-returned address id), so the local lat/lng cache stays linked to
  // the same address the backend knows about instead of drifting to its own id.
  async upsert(id: string, payload: { label: string; address: string; lat?: number; lng?: number; isDefault?: boolean }) {
    try {
      const addresses = await this.list();
      const idx = addresses.findIndex((item: any) => item.id === id);

      if (idx === -1) {
        const item = {
          id,
          ...payload,
          isDefault: payload.isDefault ?? false,
          createdAt: new Date().toISOString(),
        };
        await writeStoredValue(STORAGE_KEYS.ADDRESSES, [...addresses, item]);
        return item;
      }

      const next = [...addresses];
      next[idx] = { ...next[idx], ...payload, updatedAt: new Date().toISOString() };
      await writeStoredValue(STORAGE_KEYS.ADDRESSES, next);
      return next[idx];
    } catch (error) {
      console.error('Error upserting address:', error);
      return null;
    }
  },

  async remove(id: string) {
    try {
      const addresses = await this.list();
      const next = addresses.filter((item: any) => item.id !== id);
      await writeStoredValue(STORAGE_KEYS.ADDRESSES, next);
      return true;
    } catch (error) {
      console.error('Error removing address:', error);
      return false;
    }
  },
};

export const paymentMethodStorage = {
  async list() {
    return readStoredValue(STORAGE_KEYS.PAYMENT_METHODS, [] as any[]);
  },

  async get(id: string) {
    const methods = await this.list();
    return methods.find((item: any) => item.id === id) ?? null;
  },

  async create(payload: { type: string; lastFour: string; label?: string; expiryDate?: string; isDefault?: boolean }) {
    const methods = await this.list();
    const item = { id: `pm-${Date.now()}`, ...payload, isDefault: payload.isDefault ?? false };
    const next = [...methods, item];
    await writeStoredValue(STORAGE_KEYS.PAYMENT_METHODS, next);
    return item;
  },

  async update(id: string, updates: Partial<{ label: string; lastFour: string; expiryDate: string; isDefault: boolean }>) {
    const methods = await this.list();
    const next = methods.map((item: any) =>
      item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item,
    );
    await writeStoredValue(STORAGE_KEYS.PAYMENT_METHODS, next);
    return next.find((item: any) => item.id === id) ?? null;
  },

  async setDefault(id: string) {
    const methods = await this.list();
    const next = methods.map((item: any) => ({ ...item, isDefault: item.id === id }));
    await writeStoredValue(STORAGE_KEYS.PAYMENT_METHODS, next);
    return true;
  },

  async remove(id: string) {
    const methods = await this.list();
    const next = methods.filter((item: any) => item.id !== id);
    await writeStoredValue(STORAGE_KEYS.PAYMENT_METHODS, next);
    return true;
  },
};

export const skillStorage = {
  async list() {
    return readStoredValue(STORAGE_KEYS.SKILLS, [] as any[]);
  },

  async create(payload: { name: string; category: string; rate: number }) {
    const skills = await this.list();
    const item = { id: `skill-${Date.now()}`, ...payload };
    const next = [...skills, item];
    await writeStoredValue(STORAGE_KEYS.SKILLS, next);
    return item;
  },

  async remove(id: string) {
    const skills = await this.list();
    const next = skills.filter((item: any) => item.id !== id);
    await writeStoredValue(STORAGE_KEYS.SKILLS, next);
    return true;
  },
};

export const profileStorage = {
  async getProfile() {
    return readStoredValue(STORAGE_KEYS.PROFILE, null as any);
  },

  async saveProfile(payload: { name?: string; phone?: string; email?: string; bio?: string; yearsOfExperience?: string; serviceArea?: string }) {
    const current = await this.getProfile();
    const next = { ...(current ?? {}), ...payload };
    await writeStoredValue(STORAGE_KEYS.PROFILE, next);
    return next;
  },
};

// Local-only privacy preferences. There is no backend model for these yet,
// so they're device-local (not synced across a user's other devices).
export const privacySettingsStorage = {
  async get() {
    return readStoredValue(STORAGE_KEYS.PRIVACY_SETTINGS, {
      showProfile: true,
      usage: false,
    });
  },

  async save(payload: { showProfile: boolean; usage: boolean }) {
    await writeStoredValue(STORAGE_KEYS.PRIVACY_SETTINGS, payload);
    return payload;
  },
};

export const certificationStorage = {
  async list() {
    return readStoredValue(STORAGE_KEYS.CERTIFICATIONS, [] as any[]);
  },

  async get(id: string) {
    try {
      const certifications = await this.list();
      return certifications.find((item: any) => item.id === id) ?? null;
    } catch (error) {
      console.error('Error reading certification:', error);
      return null;
    }
  },

  async create(payload: { name: string; issuer: string; issueDate: string; expiryDate?: string; status?: string }) {
    try {
      const certifications = await this.list();
      const item = {
        id: `cert-${Date.now()}`,
        ...payload,
        status: payload.status ?? 'Pending',
        createdAt: new Date().toISOString(),
      };
      const next = [...certifications, item];
      await writeStoredValue(STORAGE_KEYS.CERTIFICATIONS, next);
      return item;
    } catch (error) {
      console.error('Error creating certification:', error);
      return null;
    }
  },

  async update(id: string, updates: Partial<{ name: string; issuer: string; issueDate: string; expiryDate: string; status: string }>) {
    try {
      const certifications = await this.list();
      const next = certifications.map((item: any) =>
        item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item,
      );
      await writeStoredValue(STORAGE_KEYS.CERTIFICATIONS, next);
      return next.find((item: any) => item.id === id) ?? null;
    } catch (error) {
      console.error('Error updating certification:', error);
      return null;
    }
  },

  async remove(id: string) {
    try {
      const certifications = await this.list();
      const next = certifications.filter((item: any) => item.id !== id);
      await writeStoredValue(STORAGE_KEYS.CERTIFICATIONS, next);
      return true;
    } catch (error) {
      console.error('Error removing certification:', error);
      return false;
    }
  },
};

// General storage utilities
export const appStorage = {
  async clearAll() {
    try {
      await AsyncStorage.clear();
    } catch (error) {
      console.error('Error clearing all storage:', error);
    }
  },
};
