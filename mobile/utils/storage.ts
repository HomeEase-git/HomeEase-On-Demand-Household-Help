import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  AUTH_TOKEN: '@homeease_auth_token',
  AUTH_USER: '@homeease_auth_user',
  BOOKING_DRAFT: '@homeease_booking_draft',
  SEARCH_HISTORY: '@homeease_search_history',
  BOOKINGS_CACHE: '@homeease_bookings_cache',
  MESSAGES_CACHE: '@homeease_messages_cache',
  NOTIFICATIONS_CACHE: '@homeease_notifications_cache',
  WORKERS_CACHE: '@homeease_workers_cache',
  ADDRESSES: '@homeease_addresses',
  CERTIFICATIONS: '@homeease_certifications',
  PAYMENT_METHODS: '@homeease_payment_methods',
  SKILLS: '@homeease_skills',
  PROFILE: '@homeease_profile',
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

// Auth Storage
export const authStorage = {
  async saveToken(token: string) {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    } catch (error) {
      console.error('Error saving auth token:', error);
    }
  },

  async getToken() {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
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
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      await AsyncStorage.removeItem(STORAGE_KEYS.AUTH_USER);
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

  // Cache full bookings list for offline access
  async cacheBookings(bookings: any[]) {
    try {
      const data = {
        bookings,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.BOOKINGS_CACHE, JSON.stringify(data));
    } catch (error) {
      console.error('Error caching bookings:', error);
    }
  },

  async getCachedBookings() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.BOOKINGS_CACHE);
      return data ? JSON.parse(data).bookings : [];
    } catch (error) {
      console.error('Error reading cached bookings:', error);
      return [];
    }
  },

  async clearBookingsCache() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.BOOKINGS_CACHE);
    } catch (error) {
      console.error('Error clearing bookings cache:', error);
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

// Messages Cache Storage
export const messageStorage = {
  async cacheMessages(conversationId: string, messages: any[]) {
    try {
      const data = {
        messages,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(
        `${STORAGE_KEYS.MESSAGES_CACHE}_${conversationId}`,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error('Error caching messages:', error);
    }
  },

  async getCachedMessages(conversationId: string) {
    try {
      const data = await AsyncStorage.getItem(
        `${STORAGE_KEYS.MESSAGES_CACHE}_${conversationId}`
      );
      return data ? JSON.parse(data).messages : [];
    } catch (error) {
      console.error('Error reading cached messages:', error);
      return [];
    }
  },

  async clearMessagesCache(conversationId?: string) {
    try {
      if (conversationId) {
        await AsyncStorage.removeItem(
          `${STORAGE_KEYS.MESSAGES_CACHE}_${conversationId}`
        );
      } else {
        // Clear all message caches
        const keys = await AsyncStorage.getAllKeys();
        const messageKeys = keys.filter((k) => k.startsWith(STORAGE_KEYS.MESSAGES_CACHE));
        await AsyncStorage.multiRemove(messageKeys);
      }
    } catch (error) {
      console.error('Error clearing messages cache:', error);
    }
  },
};

// Notifications Cache Storage
export const notificationStorage = {
  async cacheNotifications(notifications: any[]) {
    try {
      const data = {
        notifications,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(
        STORAGE_KEYS.NOTIFICATIONS_CACHE,
        JSON.stringify(data)
      );
    } catch (error) {
      console.error('Error caching notifications:', error);
    }
  },

  async getCachedNotifications() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_CACHE);
      return data ? JSON.parse(data).notifications : [];
    } catch (error) {
      console.error('Error reading cached notifications:', error);
      return [];
    }
  },

  async clearNotificationsCache() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.NOTIFICATIONS_CACHE);
    } catch (error) {
      console.error('Error clearing notifications cache:', error);
    }
  },
};

// Workers Cache Storage
export const workerStorage = {
  async cacheWorkers(workers: any[]) {
    try {
      const data = {
        workers,
        timestamp: Date.now(),
      };
      await AsyncStorage.setItem(STORAGE_KEYS.WORKERS_CACHE, JSON.stringify(data));
    } catch (error) {
      console.error('Error caching workers:', error);
    }
  },

  async getCachedWorkers() {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.WORKERS_CACHE);
      return data ? JSON.parse(data).workers : [];
    } catch (error) {
      console.error('Error reading cached workers:', error);
      return [];
    }
  },

  async clearWorkersCache() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.WORKERS_CACHE);
    } catch (error) {
      console.error('Error clearing workers cache:', error);
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

  async create(payload: { label: string; address: string; isDefault?: boolean }) {
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

  async update(id: string, updates: Partial<{ label: string; address: string; isDefault: boolean }>) {
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

  /**
   * Clear only cached data (not auth or user prefs)
   */
  async clearCaches() {
    try {
      await Promise.all([
        bookingStorage.clearBookingsCache(),
        messageStorage.clearMessagesCache(),
        notificationStorage.clearNotificationsCache(),
        workerStorage.clearWorkersCache(),
      ]);
      console.log('[Storage] All caches cleared');
    } catch (error) {
      console.error('Error clearing caches:', error);
    }
  },
};
