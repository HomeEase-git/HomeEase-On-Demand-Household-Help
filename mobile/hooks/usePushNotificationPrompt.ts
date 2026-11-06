import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import { notificationService } from '../services/notificationService';
import { useAuthStore } from '../store/authStore';

let promptedForUserId: string | null = null;
useAuthStore.subscribe((state) => {
  if (!state.user) promptedForUserId = null;
});

export function usePushNotificationPrompt() {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!userId || promptedForUserId === userId) return;
    promptedForUserId = userId;

    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            notificationService.requestPermissions().catch((error) => {
              console.error('[usePushNotificationPrompt] Failed to set up push notifications:', error);
            });
          }, 2000);
        });
      });
    });
  }, [userId]);
}
