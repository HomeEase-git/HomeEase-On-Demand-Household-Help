import type { Prisma, TimeSlot } from '@prisma/client';
import prisma from '@config/database';

/**
 * Scheduling and worker availability.
 *
 * A booking is a PH calendar date (stored as UTC midnight, see toDayStart)
 * plus an exact PH-local start time "HH:mm". Workers aren't limited to a
 * number of jobs per day. A worker is available on a date when its weekday
 * is in WorkerProfile.availableDays, unless a WorkerDateOverride for that
 * date says otherwise.
 */

type DbClient = typeof prisma | Prisma.TransactionClient;

/** Normalizes any Date/date-like value to UTC midnight, matching how booking dates are stored. */
export function toDayStart(date: Date | string): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// The Philippines doesn't observe DST, so a fixed offset is always correct
// for converting a UTC instant to PH local wall-clock time.
export const PH_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Today's PH calendar date, as UTC midnight (same form as Booking.scheduledDate). */
export function phTodayStart(now: Date = new Date()): Date {
  return toDayStart(new Date(now.getTime() + PH_UTC_OFFSET_MS));
}

/** Adds whole days to a UTC-midnight date. */
export function addDays(day: Date, days: number): Date {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** YYYY-MM-DD for a UTC-midnight date. */
export function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

// Clients pick a start time (any minute) from FIRST_START_HOUR:00 to
// LAST_START_HOUR:00 (PH local). Mirrored on mobile in utils/bookingTime.ts.
export const FIRST_START_HOUR = 7;
export const LAST_START_HOUR = 18;
// How far ahead a client can book.
export const MAX_BOOKING_DAYS_AHEAD = 60;

/** "HH:mm" between FIRST_START_HOUR:00 and LAST_START_HOUR:00. */
export function isValidStartTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:[0-5]\d$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  const minutes = hour * 60 + minute;
  return minutes >= FIRST_START_HOUR * 60 && minutes <= LAST_START_HOUR * 60;
}

/** "13:00" -> "1:00 PM", for messages. */
export function formatTime12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

// Start of the old MORNING/AFTERNOON/EVENING slots, for bookings made
// before exact times existed.
const LEGACY_SLOT_START: Record<TimeSlot, string> = {
  MORNING: '08:00',
  AFTERNOON: '12:00',
  EVENING: '16:00',
};

/** The PH-local "HH:mm" a booking starts at (falls back to its legacy slot, then 08:00). */
export function bookingStartTime(booking: { scheduledTime?: string | null; timeSlot?: TimeSlot | null }): string {
  if (booking.scheduledTime && /^\d{2}:\d{2}$/.test(booking.scheduledTime)) return booking.scheduledTime;
  if (booking.timeSlot) return LEGACY_SLOT_START[booking.timeSlot];
  return '08:00';
}

/** The real UTC instant a PH date + "HH:mm" start time happens. */
export function startInstant(scheduledDate: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(toDayStart(scheduledDate).getTime() + (h * 60 + m) * 60 * 1000 - PH_UTC_OFFSET_MS);
}

/** The real UTC instant a booking starts. */
export function bookingStartInstant(booking: {
  scheduledDate: Date;
  scheduledTime?: string | null;
  timeSlot?: TimeSlot | null;
}): Date {
  return startInstant(booking.scheduledDate, bookingStartTime(booking));
}

/** Whether a PH date is today (a same-day, "rush" booking). */
export function isRushDate(date: Date | string, now: Date = new Date()): boolean {
  return toDayStart(date).getTime() === phTodayStart(now).getTime();
}

export type StartCheck = { ok: true; isRush: boolean } | { ok: false; message: string };

/**
 * Whether a client may book (or reschedule to) this date + start time: not
 * in the past, within MAX_BOOKING_DAYS_AHEAD, and for a same-day booking at
 * least rushMinLeadHours from now so the worker can accept and travel.
 */
export function checkBookingStart(
  date: Date | string,
  time: string,
  rushMinLeadHours: number,
  now: Date = new Date()
): StartCheck {
  if (!isValidStartTime(time)) {
    return {
      ok: false,
      message: `Start time must be between ${formatTime12h(`${FIRST_START_HOUR}:00`)} and ${formatTime12h(`${LAST_START_HOUR}:00`)}`,
    };
  }
  const day = toDayStart(date);
  const today = phTodayStart(now);
  if (day.getTime() < today.getTime()) {
    return { ok: false, message: 'That date has already passed' };
  }
  if (day.getTime() > addDays(today, MAX_BOOKING_DAYS_AHEAD).getTime()) {
    return { ok: false, message: `You can book up to ${MAX_BOOKING_DAYS_AHEAD} days ahead` };
  }
  const isRush = day.getTime() === today.getTime();
  if (isRush && startInstant(day, time).getTime() < now.getTime() + rushMinLeadHours * HOUR_MS) {
    return {
      ok: false,
      message: `Same-day bookings must start at least ${rushMinLeadHours} hour${rushMinLeadHours === 1 ? '' : 's'} from now`,
    };
  }
  return { ok: true, isRush };
}

/**
 * Flag-only arrival check: whether a check-in is on a different day, more
 * than 2 hours early, or after the no-show grace period. Never blocks the
 * check-in itself; it's surfaced for admin review.
 */
export function isOutsideBookedWindow(start: Date, at: Date, graceMinutes: number): boolean {
  const phAtDay = toDayStart(new Date(at.getTime() + PH_UTC_OFFSET_MS));
  const phStartDay = toDayStart(new Date(start.getTime() + PH_UTC_OFFSET_MS));
  if (phAtDay.getTime() !== phStartDay.getTime()) return true;
  return at.getTime() < start.getTime() - 2 * HOUR_MS || at.getTime() > start.getTime() + graceMinutes * 60 * 1000;
}

/** 0 = Sunday ... 6 = Saturday for a UTC-midnight PH date. */
export function weekdayOf(date: Date | string): number {
  return toDayStart(date).getUTCDay();
}

/**
 * Prisma filter: workers available on this date — the weekday is on their
 * weekly schedule and not closed by an override, or an override opens it.
 */
export function availableOnDateWhere(date: Date | string): Prisma.WorkerProfileWhereInput {
  const day = toDayStart(date);
  return {
    OR: [
      { dateOverrides: { some: { date: day, isAvailable: true } } },
      {
        availableDays: { has: weekdayOf(day) },
        dateOverrides: { none: { date: day, isAvailable: false } },
      },
    ],
  };
}

/** Whether one worker is available on a date (see availableOnDateWhere). */
export async function isWorkerAvailableOn(
  db: DbClient,
  worker: { id: string; availableDays: number[] },
  date: Date | string
): Promise<boolean> {
  const day = toDayStart(date);
  const override = await db.workerDateOverride.findUnique({
    where: { workerProfileId_date: { workerProfileId: worker.id, date: day } },
  });
  if (override) return override.isAvailable;
  return worker.availableDays.includes(day.getUTCDay());
}

// Bookings that still occupy the worker's day.
export const LIVE_BOOKING_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'IN_PROGRESS',
  'QUOTE_SUBMITTED',
  'QUOTE_APPROVED',
  'DISPUTED',
] as const;

// Bookings the worker has committed to (shown as jobs on their calendar).
const COMMITTED_BOOKING_STATUSES = ['ACCEPTED', 'IN_PROGRESS', 'QUOTE_SUBMITTED', 'QUOTE_APPROVED', 'DISPUTED'] as const;

export type CalendarDay = {
  date: string;
  available: boolean;
  // true when the worker changed this date from their weekly schedule
  overridden: boolean;
  jobCount: number;
  jobs: { bookingId: string; time: string; service: string; kind: 'JOB' | 'VISIT'; status: string }[];
};

/**
 * One worker's calendar between two dates (inclusive): availability plus the
 * accepted jobs and follow-up visits on each day.
 */
export async function getWorkerCalendar(
  db: DbClient,
  worker: { id: string; userId: string; availableDays: number[] },
  from: Date,
  to: Date
): Promise<CalendarDay[]> {
  const start = toDayStart(from);
  const end = toDayStart(to);

  const [overrides, bookings, visits] = await Promise.all([
    db.workerDateOverride.findMany({ where: { workerProfileId: worker.id, date: { gte: start, lte: end } } }),
    db.booking.findMany({
      where: {
        workerId: worker.userId,
        scheduledDate: { gte: start, lte: end },
        status: { in: [...COMMITTED_BOOKING_STATUSES] },
      },
      select: {
        id: true,
        scheduledDate: true,
        scheduledTime: true,
        timeSlot: true,
        status: true,
        serviceType: true,
        serviceTask: { select: { name: true } },
      },
    }),
    db.bookingVisit.findMany({
      where: {
        scheduledDate: { gte: start, lte: end },
        status: 'SCHEDULED',
        booking: { workerId: worker.userId, status: { in: [...COMMITTED_BOOKING_STATUSES] } },
      },
      select: {
        scheduledDate: true,
        scheduledTime: true,
        booking: { select: { id: true, status: true, serviceType: true, serviceTask: { select: { name: true } } } },
      },
    }),
  ]);

  const overrideByDay = new Map(overrides.map((o) => [isoDay(o.date), o.isAvailable]));
  const jobsByDay = new Map<string, CalendarDay['jobs']>();
  const push = (day: string, job: CalendarDay['jobs'][number]) => {
    if (!jobsByDay.has(day)) jobsByDay.set(day, []);
    jobsByDay.get(day)!.push(job);
  };
  for (const b of bookings) {
    push(isoDay(b.scheduledDate), {
      bookingId: b.id,
      time: bookingStartTime(b),
      service: b.serviceTask?.name ?? b.serviceType,
      kind: 'JOB',
      status: b.status,
    });
  }
  for (const v of visits) {
    push(isoDay(v.scheduledDate), {
      bookingId: v.booking.id,
      time: v.scheduledTime,
      service: v.booking.serviceTask?.name ?? v.booking.serviceType,
      kind: 'VISIT',
      status: v.booking.status,
    });
  }

  const days: CalendarDay[] = [];
  for (let day = start; day.getTime() <= end.getTime(); day = addDays(day, 1)) {
    const key = isoDay(day);
    const override = overrideByDay.get(key);
    const jobs = (jobsByDay.get(key) ?? []).sort((a, b) => a.time.localeCompare(b.time));
    days.push({
      date: key,
      available: override ?? worker.availableDays.includes(day.getUTCDay()),
      overridden: override !== undefined,
      jobCount: jobs.length,
      jobs,
    });
  }
  return days;
}

/**
 * The worker's other committed jobs on a date whose start time is within
 * `windowHours` of `time` — shown as an overlap warning before they accept.
 */
export async function findNearbyJobs(
  db: DbClient,
  workerUserId: string,
  date: Date,
  time: string,
  excludeBookingId: string,
  windowHours = 3
): Promise<{ bookingId: string; time: string; service: string }[]> {
  const day = toDayStart(date);
  const [bookings, visits] = await Promise.all([
    db.booking.findMany({
      where: {
        workerId: workerUserId,
        id: { not: excludeBookingId },
        scheduledDate: day,
        status: { in: [...COMMITTED_BOOKING_STATUSES] },
      },
      select: { id: true, scheduledTime: true, timeSlot: true, serviceType: true, serviceTask: { select: { name: true } } },
    }),
    db.bookingVisit.findMany({
      where: {
        scheduledDate: day,
        status: 'SCHEDULED',
        bookingId: { not: excludeBookingId },
        booking: { workerId: workerUserId, status: { in: [...COMMITTED_BOOKING_STATUSES] } },
      },
      select: { scheduledTime: true, booking: { select: { id: true, serviceType: true, serviceTask: { select: { name: true } } } } },
    }),
  ]);
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const target = toMinutes(time);
  const all = [
    ...bookings.map((b) => ({ bookingId: b.id, time: bookingStartTime(b), service: b.serviceTask?.name ?? b.serviceType })),
    ...visits.map((v) => ({
      bookingId: v.booking.id,
      time: v.scheduledTime,
      service: v.booking.serviceTask?.name ?? v.booking.serviceType,
    })),
  ];
  return all.filter((j) => Math.abs(toMinutes(j.time) - target) < windowHours * 60).sort((a, b) => a.time.localeCompare(b.time));
}
