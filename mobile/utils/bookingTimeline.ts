import type { BookingStatus } from "../store/bookingStore";

/**
 * Where a client's booking is in its life, for the status summary at the
 * top of the booking detail screen.
 *
 * Four plain steps, whatever the backend status: the client books (Waiting),
 * a worker takes it (Confirmed), the work happens (Ongoing) and it ends
 * (Done). At the end the worker sends an invoice and the client pays it:
 * cash to the worker, or GCash/Maya in the app. The quote statuses only
 * appear on bookings from before invoices.
 */
export const TIMELINE_STEPS = ["Waiting", "Confirmed", "Ongoing", "Done"] as const;

export type TimelineTone = "normal" | "action" | "issue" | "stopped";

export type BookingTimeline = {
  /** Index into TIMELINE_STEPS of the step happening now; steps before it are done. */
  current: number;
  headline: string;
  detail: string;
  tone: TimelineTone;
};

/** "2:10 PM – 4:35 PM (2h 25m)" from the worker's start/finish stamps; null until both exist. */
export function formatJobTime(startIso?: string | null, endIso?: string | null): string | null {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const time = (d: Date) =>
    d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
  const duration = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return `${time(start)} – ${time(end)} (${duration})`;
}

export function getBookingTimeline(
  status: BookingStatus,
  {
    scheduledDate,
    workerName,
    isCash = true,
  }: { scheduledDate?: string; workerName?: string; isCash?: boolean } = {},
): BookingTimeline {
  const who = workerName && workerName !== "Unassigned" ? workerName : "Your worker";
  switch (status) {
    case "Pending":
      return {
        current: 0,
        tone: "normal",
        headline: "Finding your worker",
        detail: "We'll let you know as soon as a worker confirms.",
      };
    case "Accepted":
      return {
        current: 1,
        tone: "normal",
        headline: "Your booking is confirmed",
        detail: scheduledDate ? `${who} will come on ${scheduledDate}.` : `${who} will do your job.`,
      };
    case "QuoteSubmitted":
      return {
        current: 1,
        tone: "action",
        headline: "Check the price",
        detail: `${who} looked at the job and sent a price. Work starts after you approve it.`,
      };
    case "QuoteApproved":
      return { current: 1, tone: "normal", headline: "Price approved", detail: `${who} can start the job now.` };
    case "InProgress":
      return { current: 2, tone: "normal", headline: "Work is underway", detail: `${who} is working on your job.` };
    case "Disputed":
      return {
        current: 2,
        tone: "issue",
        headline: "Under review",
        detail: "HomeEase is checking this booking. Don't pay until we update you here.",
      };
    case "PendingCompletion":
      return isCash
        ? { current: 3, tone: "action", headline: "Payment due", detail: `${who} finished the job and sent the invoice. Pay them in cash.` }
        : { current: 3, tone: "action", headline: "Payment due", detail: `${who} finished the job and sent the invoice. Pay in the app.` };
    case "AwaitingPayment":
      return {
        current: 3,
        tone: "action",
        headline: "Payment needed",
        detail: `${who} finished the job. Pay to finish your booking.`,
      };
    case "Completed":
      return { current: TIMELINE_STEPS.length, tone: "normal", headline: "All done", detail: "Thanks for booking with HomeEase." };
    case "Cancelled":
      return {
        current: 0,
        tone: "stopped",
        headline: "Booking cancelled",
        detail: "This booking was cancelled and won't go ahead.",
      };
    case "Declined":
      return {
        current: 0,
        tone: "stopped",
        headline: `${who} can't take this job`,
        detail: "Your details are saved, so you can find another worker.",
      };
    default:
      return { current: 0, tone: "normal", headline: "Booking received", detail: "" };
  }
}
