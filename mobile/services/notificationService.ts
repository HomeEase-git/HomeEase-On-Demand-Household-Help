import type * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { authStorage } from '../utils/storage';
import { updatePushToken, removePushToken } from './api';

/**
 * Push Notification Types
 */
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

/**
 * expo-notifications registers a push-token listener as soon as the module is
 * imported, which logs a warning/error whenever the app is running in Expo Go
 * (remote push was removed from Expo Go in SDK 53). Loading the module lazily,
 * and only outside Expo Go, keeps that log out of the Expo Go dev workflow
 * while leaving full functionality intact in development builds/production.
 */
let notificationsModulePromise: Promise<typeof Notifications | null> | null = null;

function getNotificationsModule(): Promise<typeof Notifications | null> {
  if (!notificationsModulePromise) {
    notificationsModulePromise = isRunningInExpoGo()
      ? Promise.resolve(null)
      : import('expo-notifications');
  }
  return notificationsModulePromise;
}

/**
 * NotificationService
 *
 * Handles Firebase Cloud Messaging setup and local notification management.
 *
 * Features:
 * - Request user permissions
 * - Obtain and store push token
 * - Handle local notifications (foreground)
 * - Setup deep linking for notification taps
 * - Log and debug notification events
 *
 * No-ops when running in Expo Go — use a development build to test push
 * notifications and other native-only behavior.
 */
class NotificationService {
  private token: PushNotificationToken | null = null;
  private listeners: Array<{
    event: 'received' | 'interaction';
    callback: (notification: Notifications.Notification) => void;
  }> = [];

  /**
   * Initialize notifications service
   *
   * Call this once on app startup
   */
  async initialize(): Promise<void> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) {
        console.log('[Notifications] Skipped in Expo Go — use a development build to test notifications.');
        return;
      }

      // Configure notification handler
      this.setupNotificationHandlers(Notifications);

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

  /**
   * Request notification permissions from user
   *
   * @returns true if permission granted
   */
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

  /**
   * Obtain and store push token
   *
   * Token should be sent to backend when user logs in
   * Use notificationService.getToken() to retrieve it
   */
  private async obtainPushToken(): Promise<void> {
    try {
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;

      // Push tokens need Firebase Cloud Messaging on Android, wired up via
      // app.json's android.googleServicesFile — never configured for this
      // app. Calling getExpoPushTokenAsync() without it doesn't just reject
      // cleanly like the try/catch here would normally handle: it was
      // observed causing a native crash (not a catchable JS rejection) the
      // first time a fresh install's notification permission is granted.
      // Skip the call entirely until Firebase is set up — this re-enables
      // itself automatically the moment googleServicesFile is configured,
      // no need to remember to revert this guard.
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

      // Get Expo push token (can be used with Expo Push Service)
      // For Firebase FCM, this needs to be converted server-side
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

  /**
   * Get current push token
   */
  getToken(): PushNotificationToken | null {
    return this.token;
  }

  /**
   * Send the obtained push token to the backend so server-initiated events
   * (new booking, message, payment, etc.) can reach this device even while
   * the app is closed. No-ops if there's no logged-in session yet — this can
   * run on a cold boot before auth restores, and the token gets (re)sent
   * right after a successful login/verification anyway (see useAuth.ts).
   */
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

  /**
   * Clear the push token both locally and on the backend — call on logout so
   * a signed-out device stops receiving pushes meant for the next user.
   */
  async clearTokenFromBackend(): Promise<void> {
    try {
      await removePushToken();
    } catch (error) {
      console.error('[Notifications] Failed to remove push token from backend:', error);
    } finally {
      this.token = null;
    }
  }

  /**
   * Setup notification handlers
   *
   * Configures default notification behavior
   */
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
          shouldPlaySound: true,
          shouldSetBadge: true,
        };
      },
    });
  }

  /**
   * Listen for notifications received while app is in foreground
   */
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

  /**
   * Listen for notification interactions (taps)
   */
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

  /**
   * Send local notification (for testing)
   */
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

  /**
   * Clear all notifications
   */
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

  /**
   * Get notification badge count
   */
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

  /**
   * Set notification badge count
   */
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

  /**
   * Get platform identifier
   */
  private getPlatform(): 'ios' | 'android' | 'web' {
    if (Constants.platform?.ios) return 'ios';
    if (Constants.platform?.android) return 'android';
    return 'web';
  }
}

// Singleton instance
export const notificationService = new NotificationService();

/**
 * Initialize notification service on app startup
 *
 * Usage in app._layout.tsx:
 *   useEffect(() => {
 *     notificationService.initialize();
 *   }, []);
 */
export async function initializeNotificationService(): Promise<void> {
  await notificationService.initialize();
}
