import * as Haptics from "expo-haptics";

/**
 * Haptic feedback helpers — one place for the app's vibration vocabulary so
 * screens say *what happened* (tap / success / warning) instead of picking
 * raw expo-haptics styles. Every call is fire-and-forget: a device without a
 * vibrator (or an emulator) just rejects, which is swallowed here.
 */

/** Light tick for everyday taps: tab switches, toggles, card presses. */
export function tap(): void {
  Haptics.selectionAsync().catch(() => {});
}

/** Completed an important action: booking confirmed, quote accepted, payout requested. */
export function success(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** Destructive or cautionary action: cancel, decline, delete. */
export function warning(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

/** Something failed: request error, validation blocked the action. */
export function error(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

export const feedback = { tap, success, warning, error };
