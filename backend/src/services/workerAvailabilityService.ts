import type { Prisma, TimeSlot } from '@prisma/client';
import prisma from '@config/database';

export const MAX_SLOTS_PER_DAY = 2;

/** Normalizes any Date/date-like value to UTC midnight, matching how slots are stored. */
export function toDayStart(date: Date | string): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

type DbClient = typeof prisma | Prisma.TransactionClient;

export function findSlot(db: DbClient, workerProfileId: string, date: Date, timeSlot: TimeSlot) {
  return db.workerAvailability.findUnique({
    where: {
      workerProfileId_date_timeSlot: {
        workerProfileId,
        date: toDayStart(date),
        timeSlot,
      },
    },
  });
}

/**
 * Marks a slot as booked, creating the row if the worker never explicitly
 * opened it (an accepted booking should still occupy the slot on the
 * calendar even if the worker manages availability loosely).
 */
export async function markSlotBooked(
  db: DbClient,
  workerProfileId: string,
  date: Date,
  timeSlot: TimeSlot
) {
  const day = toDayStart(date);
  return db.workerAvailability.upsert({
    where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot } },
    create: { workerProfileId, date: day, timeSlot, isBooked: true },
    update: { isBooked: true },
  });
}

/** Frees a slot once its booking is no longer active (completed/cancelled/rejected). */
export async function freeSlot(db: DbClient, workerProfileId: string, date: Date, timeSlot: TimeSlot) {
  const day = toDayStart(date);
  const existing = await db.workerAvailability.findUnique({
    where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot } },
  });
  if (!existing) return null;

  return db.workerAvailability.update({
    where: { id: existing.id },
    data: { isBooked: false },
  });
}

// Bounded so a search for a worker's next open day can't run away — 14 days
// covers any realistic "how many days can one job possibly spill into"
// window (see bookingController.extendBooking).
export const RESCHEDULE_SEARCH_WINDOW_DAYS = 14;

/**
 * Reserves a date/slot for a job spillover (see bookingController.
 * extendBooking) — a calendar block, not a real booking. Mirrors
 * markSlotBooked's upsert shape but sets isBlocked + blockedByBookingId
 * instead of isBooked, and always overwrites blockedByBookingId to the
 * calling booking (a second /extend hop re-blocks the newly-vacated slot
 * under the same booking id).
 */
export async function blockSlotForExtend(
  db: DbClient,
  workerProfileId: string,
  date: Date,
  timeSlot: TimeSlot,
  bookingId: string
) {
  const day = toDayStart(date);
  return db.workerAvailability.upsert({
    where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot } },
    create: { workerProfileId, date: day, timeSlot, isBlocked: true, blockedByBookingId: bookingId },
    update: { isBlocked: true, blockedByBookingId: bookingId },
  });
}

/**
 * First open day (no row, or an existing row that's neither blocked nor
 * booked) at or after `afterDate + 1 day`, for the same TimeSlot, within
 * RESCHEDULE_SEARCH_WINDOW_DAYS — restricted to the worker's own
 * availableDays (0=Sun..6=Sat, matching Date#getUTCDay()) so a moved
 * booking never lands on a day the worker doesn't even work.
 */
export async function findNextOpenSlot(
  db: DbClient,
  workerProfileId: string,
  availableDays: number[],
  afterDate: Date,
  timeSlot: TimeSlot
): Promise<Date | null> {
  const start = toDayStart(afterDate);
  for (let i = 1; i <= RESCHEDULE_SEARCH_WINDOW_DAYS; i++) {
    const candidate = new Date(start);
    candidate.setUTCDate(candidate.getUTCDate() + i);
    if (!availableDays.includes(candidate.getUTCDay())) continue;

    const existing = await findSlot(db, workerProfileId, candidate, timeSlot);
    if (!existing || (!existing.isBlocked && !existing.isBooked)) {
      return candidate;
    }
  }
  return null;
}
