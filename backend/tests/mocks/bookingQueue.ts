// Real bookingQueue.ts connects to Redis via BullMQ. Tests don't have a
// Redis instance available, so this stand-in is swapped in via jest's
// moduleNameMapper — no test currently exercises the expiry/auto-settle/
// availability-reset job scheduling path itself, only the HTTP-level
// behavior of the endpoints that call these functions as side effects.
export const BOOKING_QUEUE_NAME = 'booking-lifecycle';

export const JOB_NAMES = {
  EXPIRE_PENDING: 'expire-pending-booking',
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings',
  RESET_AVAILABILITY: 'reset-expired-availability-slots',
} as const;

export const REPEATABLE_JOB_IDS = {
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings-hourly',
  RESET_AVAILABILITY: 'reset-expired-availability-slots-daily',
} as const;

export const bookingQueue = {
  add: jest.fn().mockResolvedValue(undefined),
  getJob: jest.fn().mockResolvedValue(null),
};

export const schedulePendingExpiry = jest.fn().mockResolvedValue(undefined);
export const cancelPendingExpiryJob = jest.fn().mockResolvedValue(undefined);
export const registerRepeatableBookingJobs = jest.fn().mockResolvedValue(undefined);
