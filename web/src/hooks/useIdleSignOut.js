import { useCallback, useEffect, useRef, useState } from 'react';

// Admin sessions end after 30 minutes without activity (the server backs this
// up — see backend sessionService ADMIN_IDLE_TIMEOUT_MINUTES). The last
// activity time is shared through localStorage, so working in one tab keeps
// the others signed in too.
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 1000;
// Pointer moves fire constantly; recording at most this often is plenty.
const RECORD_EVERY_MS = 15000;
const LAST_ACTIVITY_KEY = 'homeease_last_activity';
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'];

const readLastActivity = () => {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
};

export const recordActivity = () => {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
  } catch {
    // Storage unavailable — this tab's timer still works from its own events.
  }
};

/**
 * While `active`, calls `onTimeout` once there's been no activity in any tab
 * for IDLE_TIMEOUT_MS. Returns the seconds left while inside the final
 * warning window (null otherwise) and `stayActive` for a "Stay signed in"
 * button.
 */
export function useIdleSignOut(active, onTimeout) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const warningShown = useRef(false);
  warningShown.current = secondsLeft !== null;

  const stayActive = useCallback(() => {
    recordActivity();
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (!active) {
      setSecondsLeft(null);
      return undefined;
    }

    let lastRecorded = 0;
    const onActivity = () => {
      // Once the warning is up, only its button counts — a stray mouse move
      // shouldn't silently cancel it.
      if (warningShown.current) return;
      const now = Date.now();
      if (now - lastRecorded < RECORD_EVERY_MS) return;
      lastRecorded = now;
      recordActivity();
    };

    const check = () => {
      const last = readLastActivity();
      // No record yet (first sign-in on this browser): start the clock now.
      if (!last) {
        recordActivity();
        return;
      }
      const remaining = last + IDLE_TIMEOUT_MS - Date.now();
      if (remaining <= 0) {
        setSecondsLeft(null);
        onTimeout();
      } else if (remaining <= WARNING_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      } else {
        setSecondsLeft(null);
      }
    };

    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, { passive: true }));
    check();
    const id = setInterval(check, CHECK_EVERY_MS);
    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity));
      clearInterval(id);
    };
  }, [active, onTimeout]);

  return { secondsLeft, stayActive };
}
