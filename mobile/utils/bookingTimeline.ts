import type { BookingStatus } from "../store/bookingStore";

/**
 * Where a client's booking is in its life, for the status summary at the
 * top of the booking detail screen.
 *
 * The five steps follow the pay-after-completion flow: the worker accepts,
 * does the work (quotes happen inside "In progress"), marks it done, the
 * client confirms and pays (GCash/Maya) or it settles as cash, then it's
 * completed.
 */
export const TIMELINE_STEPS = ["Requested", "Accepted", "In progress", "Confirm & pay", "Completed"] as const;

export type TimelineTone = "normal" | "action" | "issue" | "stopped";

export type BookingTimeline = {
  /** Index into TIMELINE_STEPS of the step happening now; steps before it are done. */
  current: number;
  headline: string;
  detail: string;
  tone: TimelineTone;
};

export function getBookingTimeline(
  status: BookingStatus,
  { scheduledDate, workerName }: { scheduledDate?: string; workerName?: string } = {},
): BookingTimeline {
  const who = workerName && workerName !== "Unassigned" ? workerName : "Your worker";
  switch (status) {
    case "Pending":
      return {
        current: 1,
        tone: "normal",
        headline: "Waiting for a worker to accept",
        detail: "You'll be notified as soon as your request is accepted.",
      };
    case "Accepted":
      return {
        current: 2,
        tone: "normal",
        headline: `${who} is booked`,
        detail: scheduledDate ? `Scheduled for ${scheduledDate}.` : "The job is confirmed.",
      };
    case "InProgress":
      return { current: 2, tone: "normal", headline: "Work in progress", detail: `${who} is working on your job.` };
    case "QuoteSubmitted":
      return {
        current: 2,
        tone: "action",
        headline: "Review the quote",
        detail: `${who} sent a price for this job. Approve it or raise a concern.`,
      };
    case "QuoteApproved":
      return { current: 2, tone: "normal", headline: "Quote approved", detail: `${who} can go ahead with the work.` };
    case "PendingCompletion":
      return {
        current: 3,
        tone: "action",
        headline: "Confirm the job is done",
        detail: `${who} marked the job as finished. Check the work, then confirm.`,
      };
    case "AwaitingPayment":
      return {
        current: 3,
        tone: "action",
        headline: "Payment needed",
        detail: "Pay to complete this booking.",
      };
    case "Disputed":
      return {
        current: 3,
        tone: "issue",
        headline: "Under review",
        detail: "HomeEase is looking into this booking. We'll update you here.",
      };
    case "Completed":
      return { current: TIMELINE_STEPS.length, tone: "normal", headline: "Job completed", detail: "Thanks for booking with HomeEase." };
    case "Cancelled":
      return {
        current: 0,
        tone: "stopped",
        headline: "Booking cancelled",
        detail: "This booking was cancelled or declined and won't go ahead.",
      };
    default:
      return { current: 1, tone: "normal", headline: "Booking received", detail: "" };
  }
}
