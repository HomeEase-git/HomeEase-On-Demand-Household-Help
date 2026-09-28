/**
 * Booking start times and same-day ("rush") rules — mirrors the backend's
 * services/workerAvailabilityService.ts (FIRST_START_HOUR/LAST_START_HOUR,
 * MAX_BOOKING_DAYS_AHEAD) and AppSettings.rushFeeRate/rushMinLeadHours
 * defaults. The server re-checks everything; these only shape the pickers.
 */

export const FIRST_START_HOUR = 7;
export const LAST_START_HOUR = 18;
export const MAX_BOOKING_DAYS_AHEAD = 60;
// Fallbacks for previews before a worker is picked — the worker search
// returns the live rush rate (WorkerCard.rushFeeRate).
export const RUSH_FEE_RATE = 0.25;
export const RUSH_MIN_LEAD_HOURS = 2;

const PH_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Earliest and latest start times of the day, "HH:mm". */
export const FIRST_START_TIME = `${String(FIRST_START_HOUR).padStart(2, "0")}:00`;
export const LAST_START_TIME = `${String(LAST_START_HOUR).padStart(2, "0")}:00`;

/** "09:30" -> 570 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 570 -> "09:30" */
export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "13:00" -> "1:00 PM" */
export function formatTime12h(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

/** Today's date in the Philippines, YYYY-MM-DD (regardless of the phone's timezone). */
export function phTodayIso(now: Date = new Date()): string {
  return new Date(now.getTime() + PH_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whether a YYYY-MM-DD booking date is today in the Philippines. */
export function isRushDate(dateIso: string | null | undefined, now: Date = new Date()): boolean {
  return !!dateIso && dateIso === phTodayIso(now);
}

/** The real instant a PH date + "HH:mm" starts. */
export function startInstant(dateIso: string, time: string): Date {
  return new Date(`${dateIso}T${time}:00+08:00`);
}

/**
 * The earliest start time a client can pick for a date: FIRST_START_TIME for
 * a future date; for today, `leadHours` from now (rounded up to 5 minutes).
 * null when no time is left today.
 */
export function earliestStartTime(
  dateIso: string | null | undefined,
  leadHours: number = RUSH_MIN_LEAD_HOURS,
  now: Date = new Date(),
): string | null {
  if (!dateIso || !isRushDate(dateIso, now)) return FIRST_START_TIME;
  const phNow = new Date(now.getTime() + PH_UTC_OFFSET_MS + leadHours * 60 * 60 * 1000);
  // Lead time pushes past midnight: nothing left today.
  if (phNow.toISOString().slice(0, 10) !== dateIso) return null;
  const earliest = Math.ceil((phNow.getUTCHours() * 60 + phNow.getUTCMinutes() + phNow.getUTCSeconds() / 60) / 5) * 5;
  if (earliest > timeToMinutes(LAST_START_TIME)) return null;
  return minutesToTime(Math.max(earliest, timeToMinutes(FIRST_START_TIME)));
}

/** Whether "HH:mm" is a start time a client can pick for a date. */
export function isSelectableStartTime(
  dateIso: string | null | undefined,
  time: string | null | undefined,
  leadHours: number = RUSH_MIN_LEAD_HOURS,
  now: Date = new Date(),
): boolean {
  if (!time || !/^\d{2}:[0-5]\d$/.test(time)) return false;
  const earliest = earliestStartTime(dateIso, leadHours, now);
  if (!earliest) return false;
  const minutes = timeToMinutes(time);
  return minutes >= timeToMinutes(earliest) && minutes <= timeToMinutes(LAST_START_TIME);
}

// Start of the old Morning/Afternoon/Evening slots, for bookings made before
// exact start times.
const LEGACY_SLOT_START: Record<string, string> = { MORNING: "08:00", AFTERNOON: "12:00", EVENING: "16:00" };

/** A booking's start time: its exact time, else its old slot's start. */
export function bookingStartTime(booking: { scheduledTime?: string | null; timeSlot?: string | null }): string | null {
  if (booking.scheduledTime) return booking.scheduledTime;
  if (booking.timeSlot) return LEGACY_SLOT_START[booking.timeSlot] ?? null;
  return null;
}
