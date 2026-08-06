import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Re-invokes `callback` on a fixed interval — the polling stand-in for a
 * full push/WebSocket real-time layer. Skips a tick while the app is
 * backgrounded, and pauses entirely while `paused` is true (e.g. the screen
 * isn't focused, or an in-progress action shouldn't be disrupted).
 */
export function usePolling(callback: () => void, intervalMs: number, options: { paused?: boolean } = {}) {
  const { paused = false } = options;
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (paused) return undefined;

    const id = setInterval(() => {
      if (AppState.currentState === "active") {
        callbackRef.current();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, paused]);
}
