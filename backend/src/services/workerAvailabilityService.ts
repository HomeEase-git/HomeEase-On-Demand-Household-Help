import type { Prisma, TimeSlot } from '@prisma/client';
import prisma from '@config/database';

export const MAX_SLOTS_PER_DAY = 2;

/** Normalizes any Date/date-like value to UTC midnight, matching how slots are stored. */
export function toDayStart(date: Date | string): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// The Philippines doesn't observe DST, so a fixed offset is always correct
// for converting a UTC instant to PH local wall-clock time.
const PH_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

// PH-local hour ranges each TimeSlot represents — mirrors mobile's
// TIME_SLOT_HOURS display labels (8am-12pm / 12pm-4pm / 4pm-8pm).
const TIME_SLOT_HOUR_RANGES: Record<TimeSlot, { startHour: number; endHour: number }> = {
  MORNING: { startHour: 8, endHour: 12 },
  AFTERNOON: { startHour: 12, endHour: 16 },
  EVENING: { startHour: 16, endHour: 20 },
};

/** The real UTC instant a booked slot starts, given its PH-local hour window. */
export function getSlotStartInstant(scheduledDate: Date, timeSlot: TimeSlot): Date {
  const bookedDay = toDayStart(scheduledDate);
  const { startHour } = TIME_SLOT_HOUR_RANGES[timeSlot];
  return new Date(bookedDay.getTime() + startHour * 60 * 60 * 1000 - PH_UTC_OFFSET_MS);
}

/**
 * Whether `at` (an instant, e.g. a worker's arrival check-in) falls outside
 * the booked slot's PH-local date and hour window. Used only to flag a
 * suspicious/early/late arrival for admin dispute visibility — never to
 * block the check-in itself.
 */
export function isOutsideBookedWindow(scheduledDate: Date, timeSlot: TimeSlot, at: Date): boolean {
  const phAt = new Date(at.getTime() + PH_UTC_OFFSET_MS);
  const phDay = new Date(Date.UTC(phAt.getUTCFullYear(), phAt.getUTCMonth(), phAt.getUTCDate()));
  const bookedDay = toDayStart(scheduledDate);

  if (phDay.getTime() !== bookedDay.getTime()) return true;

  const { startHour, endHour } = TIME_SLOT_HOUR_RANGES[timeSlot];
  const phHour = phAt.getUTCHours();
  return phHour < startHour || phHour >= endHour;
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

export const SLOT_DURATION_HOURS = 4;
const SLOT_ORDER: TimeSlot[] = ['MORNING', 'AFTERNOON', 'EVENING'];

/**
 * A booking's real duration doesn't respect the fixed 4h TimeSlot buckets —
 * a 6-8h deep clean booked in MORNING only reserved that one bucket by
 * default, silently leaving AFTERNOON open for a second client to book the
 * same worker into a job that's still actually running. Returns the
 * SAME-DAY slot(s) beyond the starting one a job of this duration also
 * needs to occupy (empty if it fits in one bucket, or there's no duration
 * on file). Deliberately does not spill into the next day — a job that
 * long is the separate multi-day-job scheduling problem, not something this
 * fix attempts to solve.
 */
export function additionalSlotsForDuration(
  timeSlot: TimeSlot,
  estimatedDurationHours: number | null | undefined
): TimeSlot[] {
  if (!estimatedDurationHours || estimatedDurationHours <= SLOT_DURATION_HOURS) return [];
  const startIndex = SLOT_ORDER.indexOf(timeSlot);
  const slotsNeeded = Math.ceil(estimatedDurationHours / SLOT_DURATION_HOURS);
  const endIndexExclusive = Math.min(startIndex + slotsNeeded, SLOT_ORDER.length);
  return SLOT_ORDER.slice(startIndex + 1, endIndexExclusive);
}

/**
 * Whether `timeSlot` AND every additional same-day slot a job of this
 * duration would also need (see additionalSlotsForDuration) are all free.
 * Callers that don't pass estimatedDurationHours get exactly the old
 * single-slot check.
 */
export async function isSlotAndOverflowFree(
  db: DbClient,
  workerProfileId: string,
  date: Date,
  timeSlot: TimeSlot,
  estimatedDurationHours?: number | null
): Promise<boolean> {
  const slot = await findSlot(db, workerProfileId, date, timeSlot);
  if (!slot || slot.isBlocked || slot.isBooked) return false;

  for (const extraSlot of additionalSlotsForDuration(timeSlot, estimatedDurationHours)) {
    const extra = await findSlot(db, workerProfileId, date, extraSlot);
    if (extra?.isBlocked || extra?.isBooked) return false;
  }
  return true;
}

/**
 * Marks a slot as booked, creating the row if the worker never explicitly
 * opened it (an accepted booking should still occupy the slot on the
 * calendar even if the worker manages availability loosely). Pass
 * estimatedDurationHours to also mark any overflow slot a longer job spills
 * into (see additionalSlotsForDuration) — omit it (as most callers still
 * do) for the original single-slot-only behavior.
 */
export async function markSlotBooked(
  db: DbClient,
  workerProfileId: string,
  date: Date,
  timeSlot: TimeSlot,
  estimatedDurationHours?: number | null
) {
  const day = toDayStart(date);
  const result = await db.workerAvailability.upsert({
    where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot } },
    create: { workerProfileId, date: day, timeSlot, isBooked: true },
    update: { isBooked: true },
  });

  for (const extraSlot of additionalSlotsForDuration(timeSlot, estimatedDurationHours)) {
    await db.workerAvailability.upsert({
      where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot: extraSlot } },
      create: { workerProfileId, date: day, timeSlot: extraSlot, isBooked: true },
      update: { isBooked: true },
    });
  }

  return result;
}

/**
 * Frees a slot once its booking is no longer active (completed/cancelled/
 * rejected). Pass the same estimatedDurationHours markSlotBooked was
 * originally called with so any overflow slot gets freed too — omitting it
 * (as most callers still do) only frees the primary slot, matching the
 * original behavior.
 */
export async function freeSlot(
  db: DbClient,
  workerProfileId: string,
  date: Date,
  timeSlot: TimeSlot,
  estimatedDurationHours?: number | null
) {
  const day = toDayStart(date);

  for (const extraSlot of additionalSlotsForDuration(timeSlot, estimatedDurationHours)) {
    const extraExisting = await db.workerAvailability.findUnique({
      where: { workerProfileId_date_timeSlot: { workerProfileId, date: day, timeSlot: extraSlot } },
    });
    if (extraExisting) {
      await db.workerAvailability.update({ where: { id: extraExisting.id }, data: { isBooked: false } });
    }
  }

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

// How far ahead a recurring weekly template (see B8 / WorkerAvailabilityTemplate)
// gets materialized into real WorkerAvailability rows. Re-run daily (see
// bookingWorker.materializeAvailabilityTemplates) so the open horizon keeps
// rolling forward instead of only covering the day the template was saved.
export const TEMPLATE_MATERIALIZE_DAYS_AHEAD = 30;

/**
 * Opens WorkerAvailability rows matching one worker's recurring weekly
 * template for the next TEMPLATE_MATERIALIZE_DAYS_AHEAD days. Create-only —
 * never touches a row that already exists, so a manual close or a bulk
 * "mark unavailable" block (see setUnavailableRange) always wins over the
 * template, and re-running this is always safe/idempotent.
 */
export async function materializeTemplateForWorker(db: DbClient, workerProfileId: string): Promise<void> {
  const template = await db.workerAvailabilityTemplate.findMany({ where: { workerProfileId } });
  if (template.length === 0) return;

  const timeSlotsByDayOfWeek = new Map<number, TimeSlot[]>();
  for (const row of template) {
    if (!timeSlotsByDayOfWeek.has(row.dayOfWeek)) timeSlotsByDayOfWeek.set(row.dayOfWeek, []);
    timeSlotsByDayOfWeek.get(row.dayOfWeek)!.push(row.timeSlot);
  }

  const today = toDayStart(new Date());
  for (let i = 0; i < TEMPLATE_MATERIALIZE_DAYS_AHEAD; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    const timeSlots = timeSlotsByDayOfWeek.get(date.getUTCDay());
    if (!timeSlots) continue;

    for (const timeSlot of timeSlots) {
      const existing = await findSlot(db, workerProfileId, date, timeSlot);
      if (!existing) {
        await db.workerAvailability.create({ data: { workerProfileId, date, timeSlot, isBlocked: false } });
      }
    }
  }
}

/**
 * Bulk "mark unavailable" (see B8) — blocks every TimeSlot across
 * [startDate, endDate] (inclusive), for a vacation/leave stretch. All-or-
 * nothing, matching updateAvailabilitySlots' existing conflict rule: if any
 * date/slot in range already has an active booking, nothing is written and
 * every conflict is returned so the caller can report them all at once
 * (rather than the worker discovering conflicts one at a time).
 */
export async function setUnavailableRange(
  db: DbClient,
  workerProfileId: string,
  startDate: Date,
  endDate: Date,
  timeSlots: readonly TimeSlot[]
): Promise<{ blocked: number; conflicts: Array<{ date: string; timeSlot: TimeSlot }> }> {
  const start = toDayStart(startDate);
  const end = toDayStart(endDate);

  const dates: Date[] = [];
  for (const date = new Date(start); date.getTime() <= end.getTime(); date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(new Date(date));
  }

  const conflicts: Array<{ date: string; timeSlot: TimeSlot }> = [];
  for (const date of dates) {
    for (const timeSlot of timeSlots) {
      const existing = await findSlot(db, workerProfileId, date, timeSlot);
      if (existing?.isBooked) {
        conflicts.push({ date: date.toISOString().slice(0, 10), timeSlot });
      }
    }
  }
  if (conflicts.length > 0) {
    return { blocked: 0, conflicts };
  }

  for (const date of dates) {
    for (const timeSlot of timeSlots) {
      await db.workerAvailability.upsert({
        where: { workerProfileId_date_timeSlot: { workerProfileId, date, timeSlot } },
        create: { workerProfileId, date, timeSlot, isBlocked: true },
        update: { isBlocked: true },
      });
    }
  }

  return { blocked: dates.length * timeSlots.length, conflicts: [] };
}
