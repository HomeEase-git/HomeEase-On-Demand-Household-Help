import { router } from 'expo-router';
import { notificationService } from '../services/notificationService';
import { useNotificationStore, notificationCategory } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';

/**
 * Notification routing utilities
 *
 * Handles:
 * - Parsing remote push payloads (see backend's notify.ts — `data` is always
 *   `{ notificationId, type }`, matching the real `Notification` row; title
 *   and body live on the OS notification content itself, not inside `data`)
 * - Routing to the notification-detail screen, which already knows how to
 *   render/deep-link onward per notification type via `notificationCategory`
 * - Updating notification stores
 * - Sound/haptics feedback
 */

type RemotePushData = { notificationId?: string; type?: string };

/**
 * Handle notification received while app in foreground
 */
export function setupNotificationReceivedHandler(): void {
  notificationService.onNotificationReceived(async (notification) => {
    try {
      const { title, body, data } = notification.request.content;
      const payloadData = (data ?? {}) as RemotePushData;

      console.log(`[NotificationHandler] Received: ${payloadData.type} - ${title}`);

      if (payloadData.notificationId) {
        const { receiveNotification } = useNotificationStore.getState();
        receiveNotification({
          id: payloadData.notificationId,
          title: title ?? 'Notification',
          message: body ?? '',
          type: payloadData.type ?? 'system',
          relatedId: null,
          isRead: false,
          createdAt: new Date().toISOString(),
        });
      }

      await playNotificationFeedback(payloadData.type);
    } catch (error) {
      console.error('[NotificationHandler] Error handling received notification:', error);
    }
  });
}

/**
 * Handle notification interaction (tap) — opens the app's own notification
 * detail screen by id, same destination as tapping it from the in-app inbox
 * list, rather than trying to deep-link straight to a booking/chat/etc. for
 * every notification type.
 */
export function setupNotificationInteractionHandler(): void {
  notificationService.onNotificationInteraction(async (notification) => {
    try {
      const payloadData = (notification.request.content.data ?? {}) as RemotePushData;
      const { notificationId } = payloadData;

      if (!notificationId) {
        console.warn('[NotificationHandler] Notification tap had no notificationId, ignoring');
        return;
      }

      const isWorker = useAuthStore.getState().user?.role === 'worker';
      router.push(
        isWorker
          ? `/(worker)/inbox/notification/${notificationId}`
          : `/(client)/inbox/notification/${notificationId}`,
      );

      const { markAsRead } = useNotificationStore.getState();
      markAsRead(notificationId);
    } catch (error) {
      console.error('[NotificationHandler] Error handling notification interaction:', error);
    }
  });
}

/**
 * Play haptic and/or sound feedback for notification, keyed off the same
 * booking/payment/review/message/system category the detail screens use.
 */
async function playNotificationFeedback(type: string | undefined): Promise<void> {
  try {
    // Import haptics if available
    const { default: haptics } = await import('expo-haptics');
    const category = notificationCategory(type ?? 'system');

    switch (category) {
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
