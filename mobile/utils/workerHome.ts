import type { WorkerJob } from "../store/workerStore";
import type { BookingStatus } from "../store/bookingStore";

// Jobs the worker has taken on and hasn't finished yet.
const COMMITTED: BookingStatus[] = ["Accepted", "InProgress", "QuoteSubmitted", "QuoteApproved"];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The job to put front and centre on the worker's home: the soonest
 * committed job from today on, or — if they're all dated earlier (work that
 * started before today and isn't finished) — the latest of those.
 */
export function pickNextJob(jobs: WorkerJob[], now = new Date()): WorkerJob | null {
  const committed = jobs
    .filter((j) => COMMITTED.includes(j.status) && !Number.isNaN(new Date(j.scheduledDate).getTime()))
    .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
  if (!committed.length) return null;
  const today = startOfDay(now);
  return committed.find((j) => new Date(j.scheduledDate).getTime() >= today) ?? committed[committed.length - 1];
}

/** Google Maps directions to a job address (opens the Maps app when installed). */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export type DayEarnings = { key: string; label: string; total: number; isToday: boolean };

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Completed earnings per day for the 7 days ending today (oldest first), in
 * the phone's local time zone.
 */
export function weeklyEarnings(
  transactions: { amount: number; status: string; date: string }[],
  now = new Date(),
): DayEarnings[] {
  const days: DayEarnings[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    days.push({
      key: dayKey(d),
      label: d.toLocaleDateString("en-PH", { weekday: "short" }),
      total: 0,
      isToday: offset === 0,
    });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const t of transactions) {
    if (t.status !== "Completed") continue;
    const when = new Date(t.date);
    if (Number.isNaN(when.getTime())) continue;
    const day = byKey.get(dayKey(when));
    if (day) day.total += Number(t.amount) || 0;
  }
  return days;
}
