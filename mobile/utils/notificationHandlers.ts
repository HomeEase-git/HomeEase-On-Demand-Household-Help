import { router } from 'expo-router';
import { notificationService } from '../services/notificationService';
import { useNotificationStore, notificationCategory, clientNotificationRoute, workerNotificationRoute } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';

type RemotePushData = { notificationId?: string; type?: string; relatedId?: string };

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
          relatedId: payloadData.relatedId ?? null,
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

export function setupNotificationInteractionHandler(): void {
  notificationService.onNotificationInteraction(async (notification) => {
    try {
      const payloadData = (notification.request.content.data ?? {}) as RemotePushData;
      const { notificationId, type, relatedId } = payloadData;

      if (!notificationId) {
        console.warn('[NotificationHandler] Notification tap had no notificationId, ignoring');
        return;
      }

      const isWorker = useAuthStore.getState().user?.role === 'worker';
      router.push(
        (isWorker
          ? workerNotificationRoute(type ?? "", relatedId, notificationId)
          : clientNotificationRoute(type ?? "", relatedId, notificationId)) as any,
      );

      const { markAsRead } = useNotificationStore.getState();
      markAsRead(notificationId);
    } catch (error) {
      console.error('[NotificationHandler] Error handling notification interaction:', error);
    }
  });
}

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

export async function clearNotificationBadge(): Promise<void> {
  try {
    await notificationService.setNotificationBadgeCount(0);
  } catch (error) {
    console.error('[NotificationHandler] Failed to clear badge:', error);
  }
}

export async function updateNotificationBadge(): Promise<void> {
  try {
    const { unreadCount } = useNotificationStore.getState();
    await notificationService.setNotificationBadgeCount(unreadCount);
  } catch (error) {
    console.error('[NotificationHandler] Failed to update badge:', error);
  }
}
