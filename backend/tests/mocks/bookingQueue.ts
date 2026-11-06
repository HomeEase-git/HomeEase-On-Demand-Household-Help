export const BOOKING_QUEUE_NAME = 'booking-lifecycle';

export const JOB_NAMES = {
  EXPIRE_PENDING: 'expire-pending-booking',
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings',
  RESET_AVAILABILITY: 'reset-expired-availability-slots',
  STUCK_BOOKING_SWEEP: 'stuck-booking-sweep',
} as const;

export const REPEATABLE_JOB_IDS = {
  AUTO_SETTLE_COMPLETED: 'auto-settle-completed-bookings-hourly',
  RESET_AVAILABILITY: 'reset-expired-availability-slots-daily',
  STUCK_BOOKING_SWEEP: 'stuck-booking-sweep-10min',
} as const;

export const bookingQueue = {
  add: jest.fn().mockResolvedValue(undefined),
  getJob: jest.fn().mockResolvedValue(null),
};

export const schedulePendingExpiry = jest.fn().mockResolvedValue(undefined);
export const cancelPendingExpiryJob = jest.fn().mockResolvedValue(undefined);
export const registerRepeatableBookingJobs = jest.fn().mockResolvedValue(undefined);
