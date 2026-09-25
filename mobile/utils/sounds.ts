import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * In-app sounds, played while the app is open. When it's closed or in the
 * background, the push notification's Android channel plays the same file
 * instead (see NOTIFICATION_CHANNELS in services/notificationService.ts and
 * the backend's pushNotificationService), so the two never overlap: the
 * foreground notification handler is silent.
 *
 * The files in assets/sounds are placeholders — replace them with final
 * sounds of the same names (and keep them short, under ~1s).
 */

export type SoundName = "newJob" | "message" | "bookingConfirmed";

const SOURCES: Record<SoundName, number> = {
  newJob: require("../assets/sounds/new_job.wav"),
  message: require("../assets/sounds/message.wav"),
  bookingConfirmed: require("../assets/sounds/booking_confirmed.wav"),
};

// A burst of events (five messages at once, a socket event plus its push)
// plays a sound once, not five times.
const MIN_GAP_MS = 1500;
const ENABLED_KEY = "settings.inAppSounds";
// Every sound is well under this; the player is released after it.
const RELEASE_AFTER_MS = 3000;

let enabled = true;
let initialized = false;
const lastPlayedAt: Partial<Record<SoundName, number>> = {};

/** Call once at startup: loads the user's setting and sets the audio mode. */
export async function initSounds(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const stored = await AsyncStorage.getItem(ENABLED_KEY);
    if (stored !== null) enabled = stored === "true";
  } catch {
    // Keep the default (on).
  }
  try {
    // Short UI blips: mix with whatever else is playing rather than pausing
    // the user's music, and stay quiet when an iPhone's silent switch is on.
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
  } catch {
    // Audio mode is best-effort; sounds still play with the defaults.
  }
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const now = Date.now();
  if (now - (lastPlayedAt[name] ?? 0) < MIN_GAP_MS) return;
  lastPlayedAt[name] = now;
  try {
    // A fresh player per sound, released once it has finished: on Android
    // each expo-audio player holds a media session for as long as it
    // exists, which would make headphone play/pause buttons replay this
    // blip instead of controlling the user's music.
    const player = createAudioPlayer(SOURCES[name]);
    player.play();
    setTimeout(() => {
      try {
        player.remove();
      } catch {
        // Already released.
      }
    }, RELEASE_AFTER_MS);
  } catch (error) {
    console.warn(`[Sounds] Could not play ${name}:`, error);
  }
}

export function areSoundsEnabled(): boolean {
  return enabled;
}

export async function setSoundsEnabled(value: boolean): Promise<void> {
  enabled = value;
  try {
    await AsyncStorage.setItem(ENABLED_KEY, String(value));
  } catch {
    // Setting still applies for this session.
  }
}
