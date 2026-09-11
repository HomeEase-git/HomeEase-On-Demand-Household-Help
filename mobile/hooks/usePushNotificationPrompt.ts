import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { notificationService } from '../services/notificationService';

let hasPromptedThisSession = false;

/**
 * Prompts for notification permission (no-ops if already decided) once per
 * app session, and obtains + registers the push token if granted.
 *
 * This used to fire from useAuth.ts's login/signup/verifyEmailOtp right
 * after authenticating, deferred with InteractionManager.runAfterInteractions
 * plus a fixed 1500ms buffer. That raced the auth-stack -> home-stack
 * navigator swap: calling this while the screen that triggered login/signup
 * was still unmounting caused a live, reproduced Fabric crash
 * (`addViewAt: ... View already has a parent`, confirmed via adb logcat on
 * 2026-09-11) when the permission flow's re-render landed in the same frame
 * as the transition's own pending mount items. The 1500ms guard was not
 * reliable under real device timing.
 *
 * Calling this from a mount effect on the destination screen instead ties it
 * to a screen whose own render has already fully committed — a full React
 * commit cycle later than the old call site, after the previous screen's
 * unmount has been flushed — rather than a guessed wall-clock delay.
 */
export function usePushNotificationPrompt() {
  const requested = useRef(false);

  useEffect(() => {
    if (hasPromptedThisSession || requested.current) return;
    requested.current = true;
    hasPromptedThisSession = true;

    InteractionManager.runAfterInteractions(() => {
      // The OS permission dialog takes the window's focus away and back,
      // which was observed live (adb logcat) to flush a backlog of pending
      // Fabric mount items from the preceding navigator swap the moment
      // focus returns — surfacing the same `addViewAt: ... View already has
      // a parent` crash even from this later, already-mounted screen. Two
      // animation frames plus a fixed buffer gives that backlog real time to
      // drain before anything requests OS focus away from the app.
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
  }, []);
}
