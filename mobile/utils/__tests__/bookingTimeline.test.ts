import { getBookingTimeline, TIMELINE_STEPS } from "../bookingTimeline";
import type { BookingStatus } from "../../store/bookingStore";

describe("getBookingTimeline", () => {
  it.each<[BookingStatus, number, string]>([
    ["Pending", 1, "normal"],
    ["Accepted", 2, "normal"],
    ["InProgress", 2, "normal"],
    ["QuoteSubmitted", 2, "action"],
    ["QuoteApproved", 2, "normal"],
    ["PendingCompletion", 3, "action"],
    ["AwaitingPayment", 3, "action"],
    ["Disputed", 3, "issue"],
    ["Completed", TIMELINE_STEPS.length, "normal"],
    ["Cancelled", 0, "stopped"],
  ])("%s is at step %i with a %s tone", (status, current, tone) => {
    const t = getBookingTimeline(status);
    expect(t.current).toBe(current);
    expect(t.tone).toBe(tone);
    expect(t.headline.length).toBeGreaterThan(0);
  });

  it("never marks a cancelled booking as accepted", () => {
    // The old stepper showed "Accepted ✓" for anything that wasn't Pending.
    expect(getBookingTimeline("Cancelled").current).toBe(0);
  });

  it("names the worker and the date when it has them", () => {
    const t = getBookingTimeline("Accepted", { workerName: "Elias", scheduledDate: "Monday, 28 September 2026" });
    expect(t.headline).toBe("Elias is booked");
    expect(t.detail).toContain("Monday, 28 September 2026");
  });

  it("falls back to a generic name while no worker is assigned", () => {
    expect(getBookingTimeline("Accepted", { workerName: "Unassigned" }).headline).toBe("Your worker is booked");
  });
});
