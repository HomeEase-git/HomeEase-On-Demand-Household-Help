import { create } from 'zustand';
import { authStorage } from '../utils/storage';
import { notificationService } from '../services/notificationService';
import { useBookingStore } from './bookingStore';
import { useMessageStore } from './messageStore';
import { useNotificationStore } from './notificationStore';

type Role = 'client' | 'worker';

export type KycStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

type User = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  role: Role;
  kycStatus?: KycStatus;
  hasAcceptedTerms?: boolean;
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
  setHasAcceptedTerms: (hasAcceptedTerms: boolean) => void;
  setToken: (token: string, refreshToken?: string) => void;
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

  setHasAcceptedTerms: (hasAcceptedTerms) => {
    const currentUser = get().user;
    if (!currentUser) return;
    const updatedUser = { ...currentUser, hasAcceptedTerms };
    set({ user: updatedUser });
    authStorage.saveUser(updatedUser);
  },

  setToken: (token, refreshToken) => {
    set({ token });
    // Persist token
    authStorage.saveToken(token);
    if (refreshToken) authStorage.saveRefreshToken(refreshToken);
  },
  
  setLoading: (loading) =>
    set({ loading }),
  
  setError: (error) =>
    set({ error }),
  
  logout: async () => {
    try {
      await notificationService.clearTokenFromBackend();
    } catch (error) {
      console.error('Error clearing push token on logout:', error);
    }

    try {
      const { postLogout } = await import('../services/api');
      await postLogout();
    } catch (error) {
      console.error('Error ending session on logout:', error);
    }

    set({
      user: null,
      isAuthenticated: false,
      token: null,
      error: null
    });
    // Clear from storage
    await authStorage.clearAuth();

    useBookingStore.setState({ bookings: [], selectedBooking: null });
    await useBookingStore.getState().clearDraft();
    useMessageStore.setState({ conversations: [], messagesByUser: {}, openChatUserId: null });
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
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

