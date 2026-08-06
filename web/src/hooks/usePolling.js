import { useEffect, useRef } from 'react';

/**
 * Re-invokes `callback` on a fixed interval — the "polling for now" stand-in
 * for a full WebSocket/push real-time layer. Skips a tick while the browser
 * tab is hidden, and pauses entirely while `paused` is true (e.g. a modal is
 * open) so a background refresh can't yank data out from under an in-progress
 * action.
 */
export function usePolling(callback, intervalMs, { paused = false } = {}) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (paused) return undefined;

    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        callbackRef.current();
      }
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, paused]);
}
