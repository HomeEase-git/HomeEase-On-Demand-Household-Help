import { create } from 'zustand';
import * as api from '../services/api';

export type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  relatedId: string | null;
  isRead: boolean;
  createdAt: string;
};

export type NotificationCategory = 'booking' | 'payment' | 'review' | 'message' | 'system';

export function notificationCategory(type: string): NotificationCategory {
  if (type.startsWith('BOOKING') || type.startsWith('QUOTE') || type === 'ADDON_ADDED') return 'booking';
  if (type.startsWith('PAYMENT')) return 'payment';
  if (type === 'REVIEW_RECEIVED') return 'review';
  if (type === 'MESSAGE_RECEIVED') return 'message';
  return 'system';
}

type NotificationState = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  receiveNotification: (notification: Notification) => void;
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,

  fetchNotifications: async () => {
    set({ loading: true });
    try {
      const notifications = await api.getNotifications();
      set({
        notifications,
        unreadCount: notifications.filter((n: Notification) => !n.isRead).length,
      });
    } catch (error) {
      console.error('Fetch notifications error:', error);
    } finally {
      set({ loading: false });
    }
  },

  markAsRead: async (id: string) => {
    const target = get().notifications.find((n) => n.id === id);
    if (!target || target.isRead) return;

    set((state) => ({
      notifications: state.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));

    try {
      await api.markNotificationRead(id);
    } catch (error) {
      console.error('Mark notification read error:', error);
    }
  },

  markAllRead: async () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));

    try {
      await api.markAllNotificationsRead();
    } catch (error) {
      console.error('Mark all notifications read error:', error);
    }
  },

  receiveNotification: (notification: Notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications],
      unreadCount: state.unreadCount + 1,
    })),
}));
