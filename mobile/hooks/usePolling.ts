import { useEffect, useRef } from "react";
import { AppState } from "react-native";

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
