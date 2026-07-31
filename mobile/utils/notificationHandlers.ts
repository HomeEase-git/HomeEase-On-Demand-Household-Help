import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { notificationService, NotificationPayload } from '../services/notificationService';
import { useNotificationStore } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';

/**
 * Notification routing utilities
 * 
 * Handles:
 * - Parsing notification payloads
 * - Routing to appropriate screens via deep links
 * - Updating notification stores
 * - Sound/haptics feedback
 */

/**
 * Handle notification received while app in foreground
 * Shows local notification with appropriate styling
 */
export function setupNotificationReceivedHandler(): void {
  notificationService.onNotificationReceived(async (notification) => {
    try {
      const payload = notification.request.content.data as NotificationPayload;

      console.log(`[NotificationHandler] Received: ${payload.type} - ${payload.title}`);

      // Update notification store
      const { receiveNotification } = useNotificationStore.getState();
      receiveNotification({
        id: notification.request.identifier,
        title: payload.title,
        message: payload.body,
        type: payload.type,
        relatedId: null,
        isRead: false,
        createdAt: new Date().toISOString(),
      });

      // Play sound/haptics
      await playNotificationFeedback(payload.type);
    } catch (error) {
      console.error('[NotificationHandler] Error handling received notification:', error);
    }
  });
}

/**
 * Handle notification interaction (tap)
 * Routes to appropriate screen using deep linking
 */
export function setupNotificationInteractionHandler(): void {
  notificationService.onNotificationInteraction(async (notification) => {
    try {
      const payload = notification.request.content.data as NotificationPayload;

      console.log(`[NotificationHandler] Interaction: ${payload.type}`);

      // Route based on notification type
      if (payload.deepLink && typeof payload.deepLink === 'string') {
        await Linking.openURL(payload.deepLink);
      } else {
        routeNotification(payload);
      }

      // Mark as read
      const { markAsRead } = useNotificationStore.getState();
      markAsRead(notification.request.identifier);
    } catch (error) {
      console.error('[NotificationHandler] Error handling notification interaction:', error);
    }
  });
}

/**
 * Route notification to appropriate screen based on type.
 * Uses expo-router's imperative `router` (real, file-based paths) rather
 * than a raw React Navigation ref, since expo-router's screens aren't
 * registered under hand-picked names like 'booking-detail'.
 */
function routeNotification(payload: any): void {
  const { type, data } = payload;
  const isWorker = useAuthStore.getState().user?.role === 'worker';

  try {
    switch (type) {
      case 'booking':
        if (isWorker) {
          router.push(
            data?.bookingId ? `/(worker)/requests/${data.bookingId}` : '/(worker)/requests',
          );
        } else if (data?.bookingId) {
          router.push(`/(client)/booking/${data.bookingId}`);
        } else {
          router.push('/(client)/booking');
        }
        break;

      case 'message':
        if (isWorker) {
          router.push(
            data?.conversationId
              ? `/(worker)/inbox/chat/${data.conversationId}`
              : '/(worker)/inbox',
          );
        } else if (data?.conversationId) {
          router.push(`/(client)/inbox/chat/${data.conversationId}`);
        } else {
          router.push('/(client)/inbox');
        }
        break;

      case 'payment':
        if (isWorker) {
          router.push(
            data?.transactionId ? `/(worker)/earnings/${data.transactionId}` : '/(worker)/earnings',
          );
        } else if (data?.transactionId) {
          router.push(`/(client)/profile/transactions/${data.transactionId}`);
        } else {
          router.push('/(client)/profile/transactions');
        }
        break;

      case 'review':
        if (isWorker) {
          router.push('/(worker)/inbox');
        } else if (data?.bookingId) {
          router.push(`/(client)/profile/rate-review/${data.bookingId}`);
        } else {
          router.push('/(client)/booking');
        }
        break;

      case 'system':
        router.push(isWorker ? '/(worker)/inbox' : '/(client)/inbox');
        break;

      default:
        console.warn(`[NotificationHandler] Unknown notification type: ${type}`);
        router.push(isWorker ? '/(worker)/inbox' : '/(client)/inbox');
    }
  } catch (error) {
    console.error('[NotificationHandler] Navigation error:', error);
  }
}

/**
 * Play haptic and/or sound feedback for notification
 */
async function playNotificationFeedback(type: string): Promise<void> {
  try {
    // Import haptics if available
    const { default: haptics } = await import('expo-haptics');

    switch (type) {
      case 'booking':
        haptics?.notificationAsync(haptics.NotificationFeedbackType.Success);
        break;
      case 'payment':
        haptics?.notificationAsync(haptics.NotificationFeedbackType.Warning);
        break;
      case 'message':
        haptics?.selectionAsync();
        break;
      default:
        haptics?.selectionAsync();
    }
  } catch (error) {
    console.log('[NotificationHandler] Haptics not available:', error);
  }
}

/**
 * Create notification payload from API response
 * 
 * Standardizes different notification types into consistent format
 */
export function createNotificationPayload(
  type: string,
  data: Record<string, any>
): NotificationPayload {
  const basePayload = {
    type: type as any,
    data,
    deepLink: data.deepLink,
  };

  switch (type) {
    case 'booking':
      return {
        ...basePayload,
        title: data.title || 'Booking Update',
        body: data.message || 'Your booking has been updated',
      };

    case 'message':
      return {
        ...basePayload,
        title: data.senderName || 'New Message',
        body: data.message || 'You have a new message',
      };

    case 'payment':
      return {
        ...basePayload,
        title: 'Payment Processed',
        body: data.message || 'Your payment has been received',
      };

    case 'review':
      return {
        ...basePayload,
        title: 'Review Request',
        body: data.message || 'Please rate your recent booking',
      };

    default:
      return {
        ...basePayload,
        title: data.title || 'Update',
        body: data.message || 'You have a new notification',
      };
  }
}

/**
 * Clear notification badge on app focus
 */
export async function clearNotificationBadge(): Promise<void> {
  try {
    await notificationService.setNotificationBadgeCount(0);
  } catch (error) {
    console.error('[NotificationHandler] Failed to clear badge:', error);
  }
}

/**
 * Update notification badge count
 */
export async function updateNotificationBadge(): Promise<void> {
  try {
    const { notifications } = useNotificationStore.getState();
    const unreadCount = notifications.filter((n) => !n.isRead).length;
    await notificationService.setNotificationBadgeCount(unreadCount);
  } catch (error) {
    console.error('[NotificationHandler] Failed to update badge:', error);
  }
}
