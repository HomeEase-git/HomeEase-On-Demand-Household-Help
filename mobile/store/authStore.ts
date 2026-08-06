import { create } from 'zustand';
import { authStorage } from '../utils/storage';

type Role = 'client' | 'worker';

export type KycStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

type User = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  role: Role;
  // Only meaningful for workers — gates access to the worker tabs until an
  // admin approves the account. Undefined for clients.
  kycStatus?: KycStatus;
} | null;

type AuthState = {
  user: User;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  token: string | null;
  isInitializing: boolean;
  
  setUser: (user: User) => void;
  setKycStatus: (kycStatus: KycStatus) => void;
  setToken: (token: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  logout: () => void;
  clearError: () => void;
  initializeAuth: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  loading: false,
  error: null,
  token: null,
  isInitializing: true,
  
  setUser: (user) => {
    set({
      user,
      isAuthenticated: !!user
    });
    // Persist user
    if (user) {
      authStorage.saveUser(user);
    }
  },
  
  setKycStatus: (kycStatus) => {
    const currentUser = get().user;
    if (!currentUser) return;
    const updatedUser = { ...currentUser, kycStatus };
    set({ user: updatedUser });
    authStorage.saveUser(updatedUser);
  },

  setToken: (token) => {
    set({ token });
    // Persist token
    authStorage.saveToken(token);
  },
  
  setLoading: (loading) =>
    set({ loading }),
  
  setError: (error) =>
    set({ error }),
  
  logout: async () => {
    set({
      user: null,
      isAuthenticated: false,
      token: null,
      error: null
    });
    // Clear from storage
    await authStorage.clearAuth();
  },
  
  clearError: () =>
    set({ error: null }),

  // Initialize auth from storage on app startup
  initializeAuth: async () => {
    try {
      const token = await authStorage.getToken();
      const user = await authStorage.getUser();

      set({
        token,
        user,
        isAuthenticated: !!token && !!user,
        isInitializing: false,
      });
    } catch (error) {
      console.error('Error initializing auth:', error);
      set({ isInitializing: false });
    }
  },
}));

