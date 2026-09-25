import type { Booking, BookingStatus } from "../store/bookingStore";

// Statuses where the booking is still going on (not finished or cancelled).
const ONGOING: BookingStatus[] = [
  "Pending",
  "Accepted",
  "InProgress",
  "QuoteSubmitted",
  "QuoteApproved",
  "PendingCompletion",
  "AwaitingPayment",
];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The booking to feature on the client home screen: the soonest ongoing
 * booking scheduled today or later, or — if every ongoing one is dated in
 * the past (e.g. work that started earlier and isn't finished) — the most
 * recent of those. Null when nothing is ongoing.
 */
export function pickUpcomingBooking(bookings: Booking[], now = new Date()): Booking | null {
  const ongoing = bookings
    .filter((b) => ONGOING.includes(b.status) && !Number.isNaN(new Date(b.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (!ongoing.length) return null;
  const today = startOfDay(now);
  return ongoing.find((b) => new Date(b.date).getTime() >= today) ?? ongoing[ongoing.length - 1];
}

export type BookAgainWorker = {
  workerId: string;
  name: string;
  avatar?: string;
  service: string;
};

/** Workers from the client's completed bookings, most recent first, one entry each. */
export function pickBookAgainWorkers(bookings: Booking[], limit = 6): BookAgainWorker[] {
  const seen = new Set<string>();
  const out: BookAgainWorker[] = [];
  const completed = bookings
    .filter((b) => b.status === "Completed" && b.workerId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  for (const b of completed) {
    if (seen.has(b.workerId!)) continue;
    seen.add(b.workerId!);
    out.push({ workerId: b.workerId!, name: b.worker, avatar: b.workerAvatar, service: b.category ?? b.service });
    if (out.length === limit) break;
  }
  return out;
}
