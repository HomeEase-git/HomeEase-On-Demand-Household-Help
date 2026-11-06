import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type SoundName = "newJob" | "message" | "bookingConfirmed";

const SOURCES: Record<SoundName, number> = {
  newJob: require("../assets/sounds/new_job.wav"),
  message: require("../assets/sounds/message.wav"),
  bookingConfirmed: require("../assets/sounds/booking_confirmed.wav"),
};

const MIN_GAP_MS = 1500;
const ENABLED_KEY = "settings.inAppSounds";
const RELEASE_AFTER_MS = 3000;

let enabled = true;
let initialized = false;
const lastPlayedAt: Partial<Record<SoundName, number>> = {};

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
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
  } catch {
  }
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const now = Date.now();
  if (now - (lastPlayedAt[name] ?? 0) < MIN_GAP_MS) return;
  lastPlayedAt[name] = now;
  try {
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
