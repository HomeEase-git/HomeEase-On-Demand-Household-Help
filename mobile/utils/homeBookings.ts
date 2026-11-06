import type { Booking, BookingStatus } from "../store/bookingStore";

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
