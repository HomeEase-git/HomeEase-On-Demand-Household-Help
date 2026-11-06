import type * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { authStorage } from '../utils/storage';
import { updatePushToken, removePushToken } from './api';

export type NotificationType = 'booking' | 'payment' | 'message' | 'review' | 'system';

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, any>;
  deepLink?: string;
};

export type PushNotificationToken = {
  token: string;
  platform: 'ios' | 'android' | 'web';
  obtainedAt: number;
};

let notificationsModulePromise: Promise<typeof Notifications | null> | null = null;

function getNotificationsModule(): Promise<typeof Notifications | null> {
  if (!notificationsModulePromise) {
    notificationsModulePromise = isRunningInExpoGo()
      ? Promise.resolve(null)
      : import('expo-notifications');
  }
  return notificationsModulePromise;
}

export const NOTIFICATION_CHANNELS = [
  { id: 'new-job', name: 'New job requests', sound: 'new_job.wav' },
  { id: 'messages', name: 'Messages', sound: 'message.wav' },
  { id: 'bookings', name: 'Booking updates', sound: 'booking_confirmed.wav' },
] as const;

class NotificationService {
  private token: PushNotificationToken | null = null;
  private listeners: Array<{
    event: 'received' | 'interaction';
    callback: (notification: Notifications.Notification) => void;
  }> = [];

  async initialize(): Promise<void> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        console.log('[Notifications] Skipped in Expo Go — use a development build to test notifications.');
        return;
      }

      // Configure notification handler
      this.setupNotificationHandlers(Notifications);

      await this.setupAndroidChannels(Notifications);

      // Check permissions
      const { granted } = await Notifications.getPermissionsAsync();
      if (!granted) {
        console.log('[Notifications] Permissions not granted yet');
        return;
      }

      // Get push token
      await this.obtainPushToken();

      console.log('[Notifications] Service initialized');
    } catch (error) {
      console.error('[Notifications] Failed to initialize:', error);
    }
  }

  async requestPermissions(): Promise<boolean> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return false;

      const { granted } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          allowCriticalAlerts: true,
          allowProvisional: true,
        },
      });

      if (granted) {
        console.log('[Notifications] ✓ Permissions granted');
        // Get token after permissions granted
        await this.obtainPushToken();
        return true;
      } else {
        console.log('[Notifications] ✗ Permissions denied');
        return false;
      }
    } catch (error) {
      console.error('[Notifications] Failed to request permissions:', error);
      return false;
    }
  }

  private async obtainPushToken(): Promise<void> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;

      if (Platform.OS === 'android' && !Constants.expoConfig?.android?.googleServicesFile) {
        console.log('[Notifications] Skipping push token fetch — Firebase not configured (no googleServicesFile in app.json)');
        return;
      }

      // Get project ID for Firebase
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId || Constants.projectId;

      if (!projectId) {
        console.warn('[Notifications] No project ID available');
        return;
      }

      const expoPushToken = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      this.token = {
        token: expoPushToken.data,
        platform: this.getPlatform(),
        obtainedAt: Date.now(),
      };

      console.log(`[Notifications] ✓ Push token obtained: ${this.token.token.substring(0, 20)}...`);

      await this.sendTokenToBackend(this.token);
    } catch (error) {
      console.error('[Notifications] Failed to obtain push token:', error);
    }
  }

  getToken(): PushNotificationToken | null {
    return this.token;
  }

  async sendTokenToBackend(token: PushNotificationToken): Promise<void> {
    try {
      const authToken = await authStorage.getToken();
      if (!authToken) {
        console.log('[Notifications] No session yet — deferring push token registration');
        return;
      }
      await updatePushToken(token.token);
      console.log('[Notifications] ✓ Push token sent to backend');
    } catch (error) {
      console.error('[Notifications] Failed to send token to backend:', error);
    }
  }

  async clearTokenFromBackend(): Promise<void> {
    try {
      await removePushToken();
    } catch (error) {
      console.error('[Notifications] Failed to remove push token from backend:', error);
    } finally {
      this.token = null;
    }
  }

  private async setupAndroidChannels(Notifications: typeof import('expo-notifications')): Promise<void> {
    if (Platform.OS !== 'android') return;
    try {
      for (const channel of NOTIFICATION_CHANNELS) {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: Notifications.AndroidImportance.HIGH,
          sound: channel.sound,
          vibrationPattern: [0, 250, 150, 250],
        });
      }
    } catch (error) {
      console.error('[Notifications] Failed to create Android channels:', error);
    }
  }

  private setupNotificationHandlers(Notifications: typeof import('expo-notifications')): void {
    // Set default notification behavior
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        console.log('[Notifications] Notification received:', {
          title: notification.request.content.title,
          body: notification.request.content.body,
        });

        return {
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: true,
        };
      },
    });
  }

  onNotificationReceived(
    callback: (notification: Notifications.Notification) => void
  ): () => void {
    let unsubscribed = false;
    let subscription: { remove: () => void } | null = null;

    getNotificationsModule().then((Notifications) => {
      if (!Notifications || unsubscribed) return;
      subscription = Notifications.addNotificationReceivedListener((notification) => {
        console.log('[Notifications] Foreground notification:', notification);
        callback(notification);
      });
    });

    return () => {
      unsubscribed = true;
      subscription?.remove();
    };
  }

  onNotificationInteraction(
    callback: (notification: Notifications.Notification) => void
  ): () => void {
    let unsubscribed = false;
    let subscription: { remove: () => void } | null = null;

    getNotificationsModule().then((Notifications) => {
      if (!Notifications || unsubscribed) return;
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        console.log('[Notifications] Notification interaction:', response);
        callback(response.notification);
      });
    });

    return () => {
      unsubscribed = true;
      subscription?.remove();
    };
  }

  async sendLocalNotification(payload: NotificationPayload): Promise<void> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: payload.title,
          body: payload.body,
          data: {
            ...payload.data,
            type: payload.type,
            deepLink: payload.deepLink,
          },
          badge: 1,
        },
        trigger: null, // Send immediately
      });

      console.log('[Notifications] Local notification sent:', payload.title);
    } catch (error) {
      console.error('[Notifications] Failed to send local notification:', error);
    }
  }

  async clearAllNotifications(): Promise<void> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;

      await Notifications.dismissAllNotificationsAsync();
      console.log('[Notifications] All notifications cleared');
    } catch (error) {
      console.error('[Notifications] Failed to clear notifications:', error);
    }
  }

  async getNotificationBadgeCount(): Promise<number> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return 0;

      const count = await Notifications.getBadgeCountAsync();
      return count || 0;
    } catch (error) {
      console.error('[Notifications] Failed to get badge count:', error);
      return 0;
    }
  }

  async setNotificationBadgeCount(count: number): Promise<void> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;

      await Notifications.setBadgeCountAsync(count);
      console.log(`[Notifications] Badge count set to ${count}`);
    } catch (error) {
      console.error('[Notifications] Failed to set badge count:', error);
    }
  }

  private getPlatform(): 'ios' | 'android' | 'web' {
    if (Constants.platform?.ios) return 'ios';
    if (Constants.platform?.android) return 'android';
    return 'web';
  }
}

// Singleton instance
export const notificationService = new NotificationService();

export async function initializeNotificationService(): Promise<void> {
  await notificationService.initialize();
}
