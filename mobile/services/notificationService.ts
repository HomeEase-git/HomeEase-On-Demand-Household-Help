import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

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
      // Configure notification handler
      this.setupNotificationHandlers();

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

      // TODO: Send token to backend once endpoint is available
      // await this.sendTokenToBackend(this.token);
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
   * Send token to backend (called after backend endpoint is ready)
   * 
   * @param token - Push token to send
   */
  async sendTokenToBackend(token: PushNotificationToken): Promise<void> {
    try {
      // This would be called from the API service
      // when backend exposes /api/users/{id}/notification-token endpoint
      console.log('[Notifications] Would send token to backend:', token.token);
      // await api.updateNotificationToken(token.token, token.platform);
    } catch (error) {
      console.error('[Notifications] Failed to send token to backend:', error);
    }
  }

  /**
   * Setup notification handlers
   * 
   * Configures default notification behavior
   */
  private setupNotificationHandlers(): void {
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
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      console.log('[Notifications] Foreground notification:', notification);
      callback(notification);
    });

    return () => subscription.remove();
  }

  /**
   * Listen for notification interactions (taps)
   */
  onNotificationInteraction(
    callback: (notification: Notifications.Notification) => void
  ): () => void {
    const subscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log('[Notifications] Notification interaction:', response);
        callback(response.notification);
      });

    return () => subscription.remove();
  }

  /**
   * Send local notification (for testing)
   */
  async sendLocalNotification(payload: NotificationPayload): Promise<void> {
    try {
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
