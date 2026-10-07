import { create } from 'zustand';
import * as api from '../services/api';
import { hasMorePages, uniqueNew } from '../utils/pagination';

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

// Where a client's push tap goes: straight to the booking (or its quote) when
// the notification names one, else the notification screen. relatedId is a
// booking id for booking/payment types only (disputes etc. use other ids).
export function clientNotificationRoute(type: string, relatedId: string | null | undefined, notificationId: string): string {
  const category = notificationCategory(type);
  if (relatedId && (category === "booking" || category === "payment")) {
    return type === "QUOTE_SUBMITTED" || type === "QUOTE_REMINDER" ? `/(client)/booking/${relatedId}/quote` : `/(client)/booking/${relatedId}`;
  }
  return `/(client)/inbox/notification/${notificationId}`;
}

type NotificationState = {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  page: number;
  hasMore: boolean;
  loadingMore: boolean;
  fetchNotifications: () => Promise<void>;
  loadMore: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  receiveNotification: (notification: Notification) => void;
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  page: 1,
  hasMore: false,
  loadingMore: false,

  // Page 1 only; older pages come in through loadMore. The badge count comes
  // from the server, since unread items can sit on pages not loaded yet.
  fetchNotifications: async () => {
    set({ loading: true });
    try {
      const [{ notifications, pagination }, unreadCount] = await Promise.all([
        api.getNotifications(1),
        api.getUnreadNotificationCount(),
      ]);
      set({ notifications, unreadCount, page: 1, hasMore: hasMorePages(pagination) });
    } catch (error) {
      console.error('Fetch notifications error:', error);
    } finally {
      set({ loading: false });
    }
  },

  loadMore: async () => {
    const { hasMore, loadingMore, loading, page } = get();
    if (!hasMore || loadingMore || loading) return;
    set({ loadingMore: true });
    try {
      const { notifications, pagination } = await api.getNotifications(page + 1);
      // A refresh landed while this was in flight; its page 1 wins.
      if (get().page !== page) return;
      set((state) => ({
        notifications: [...state.notifications, ...uniqueNew(notifications as Notification[], state.notifications)],
        page: page + 1,
        hasMore: hasMorePages(pagination),
      }));
    } catch (error) {
      console.error('Load more notifications error:', error);
    } finally {
      set({ loadingMore: false });
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

  // The same notification can arrive twice (foreground push + socket event);
  // the push copy has no relatedId, so keep whichever one knows its booking.
  receiveNotification: (notification: Notification) =>
    set((state) => {
      const existing = state.notifications.find((n) => n.id === notification.id);
      if (!existing) {
        return {
          notifications: [notification, ...state.notifications],
          unreadCount: state.unreadCount + 1,
        };
      }
      const merged = { ...existing, ...notification, relatedId: notification.relatedId ?? existing.relatedId };
      return { notifications: state.notifications.map((n) => (n.id === notification.id ? merged : n)) };
    }),
}));
