import { useCallback, useEffect, useRef, useState } from 'react';

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const WARNING_MS = 2 * 60 * 1000;
const CHECK_EVERY_MS = 1000;
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
  }
};

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
      if (warningShown.current) return;
      const now = Date.now();
      if (now - lastRecorded < RECORD_EVERY_MS) return;
      lastRecorded = now;
      recordActivity();
    };

    const check = () => {
      const last = readLastActivity();
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
