import { useEffect, useState } from 'react';

export const HOLD_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export interface HoldTimerState {
  isActive: boolean;
  remainingMs: number;
  remainingLabel: string; // "9:42"
  isExpiring: boolean; // last 60s — for urgency styling
  isExpired: boolean;
}

/**
 * Client-side-only countdown shown after a worker is selected in Step 3.
 * NOT a real server-side reservation — the backend has no "hold this worker
 * before the booking exists" concept, only the 1-hour PENDING-booking expiry
 * that starts once POST /bookings actually succeeds (see
 * queues/bookingQueue.schedulePendingExpiry on the backend). This timer is
 * purely a UX nudge to get the client through Step 4 promptly; letting it
 * expire doesn't cancel/release anything server-side — it just resets the
 * "confidence" affordance and lets the caller decide whether to re-prompt
 * the user to confirm the worker is still their pick.
 */
export function useBookingHoldTimer(holdStartedAt: number | null | undefined): HoldTimerState {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!holdStartedAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [holdStartedAt]);

  if (!holdStartedAt) {
    return { isActive: false, remainingMs: 0, remainingLabel: '0:00', isExpiring: false, isExpired: false };
  }

  const elapsed = now - holdStartedAt;
  const remainingMs = Math.max(0, HOLD_DURATION_MS - elapsed);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return {
    isActive: remainingMs > 0,
    remainingMs,
    remainingLabel: `${minutes}:${String(seconds).padStart(2, '0')}`,
    isExpiring: remainingMs > 0 && remainingMs <= 60 * 1000,
    isExpired: remainingMs === 0,
  };
}
