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

/** "07:00" ... "18:00" */
export const START_TIMES: string[] = Array.from(
  { length: LAST_START_HOUR - FIRST_START_HOUR + 1 },
  (_, i) => `${String(FIRST_START_HOUR + i).padStart(2, "0")}:00`,
);

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
 * Start times a client can still pick for a date: all of them for a future
 * date; for today, only those at least `leadHours` from now.
 */
export function selectableStartTimes(
  dateIso: string | null | undefined,
  leadHours: number = RUSH_MIN_LEAD_HOURS,
  now: Date = new Date(),
): string[] {
  if (!dateIso) return START_TIMES;
  if (!isRushDate(dateIso, now)) return START_TIMES;
  const earliest = now.getTime() + leadHours * 60 * 60 * 1000;
  return START_TIMES.filter((t) => startInstant(dateIso, t).getTime() >= earliest);
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
