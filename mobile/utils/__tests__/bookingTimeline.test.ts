import { formatJobTime, getBookingTimeline, TIMELINE_STEPS } from "../bookingTimeline";
import type { BookingStatus } from "../../store/bookingStore";

describe("formatJobTime", () => {
  it("shows PH start/end and the duration", () => {
    // 06:10 UTC = 2:10 PM Manila
    expect(formatJobTime("2026-10-13T06:10:00Z", "2026-10-13T08:35:00Z")).toMatch(/2:10.*4:35.*\(2h 25m\)$/);
    expect(formatJobTime("2026-10-13T06:10:00Z", "2026-10-13T06:50:00Z")).toMatch(/\(40m\)$/);
  });

  it("is null until both stamps exist", () => {
    expect(formatJobTime("2026-10-13T06:10:00Z", null)).toBeNull();
  });
});

describe("getBookingTimeline", () => {
  it.each<[BookingStatus, number, string]>([
    ["Pending", 0, "normal"],
    ["Accepted", 1, "normal"],
    ["QuoteSubmitted", 1, "action"],
    ["QuoteApproved", 1, "normal"],
    ["InProgress", 2, "normal"],
    ["Disputed", 2, "issue"],
    ["PendingCompletion", 3, "action"],
    ["AwaitingPayment", 3, "action"],
    ["Completed", TIMELINE_STEPS.length, "normal"],
    ["Cancelled", 0, "stopped"],
  ])("%s is at step %i with a %s tone", (status, current, tone) => {
    const t = getBookingTimeline(status);
    expect(t.current).toBe(current);
    expect(t.tone).toBe(tone);
    expect(t.headline.length).toBeGreaterThan(0);
  });

  it("has four plain steps", () => {
    expect(TIMELINE_STEPS).toEqual(["Waiting", "Confirmed", "Ongoing", "Done"]);
  });

  it("asks a GCash/Maya client to pay once the worker is done, but not a cash client", () => {
    expect(getBookingTimeline("PendingCompletion", { isCash: false }).tone).toBe("action");
    expect(getBookingTimeline("PendingCompletion", { isCash: true }).tone).toBe("action");
  });

  it("never marks a cancelled booking as confirmed", () => {
    expect(getBookingTimeline("Cancelled").current).toBe(0);
  });

  it("names the worker and the date when it has them", () => {
    const t = getBookingTimeline("Accepted", { workerName: "Elias", scheduledDate: "Monday, 28 September 2026" });
    expect(t.headline).toBe("Your booking is confirmed");
    expect(t.detail).toBe("Elias will come on Monday, 28 September 2026.");
  });

  it("falls back to a generic name while no worker is assigned", () => {
    expect(getBookingTimeline("Accepted", { workerName: "Unassigned" }).detail).toBe("Your worker will do your job.");
  });
});
