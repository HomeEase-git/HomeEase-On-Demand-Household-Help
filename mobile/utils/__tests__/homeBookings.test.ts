import { pickUpcomingBooking, pickBookAgainWorkers } from "../homeBookings";
import type { Booking } from "../../store/bookingStore";

const b = (id: string, status: Booking["status"], date: string, extra: Partial<Booking> = {}): Booking =>
  ({ id, service: "Cleaning", worker: `W${id}`, date, status, amount: 0, ...extra }) as Booking;

const NOW = new Date("2026-09-25T10:00:00");

describe("pickUpcomingBooking", () => {
  it("picks the soonest ongoing booking from today on", () => {
    const list = [
      b("1", "Accepted", "2026-10-03"),
      b("2", "Pending", "2026-09-28"),
      b("3", "Completed", "2026-09-26"),
      b("4", "Cancelled", "2026-09-26"),
    ];
    expect(pickUpcomingBooking(list, NOW)?.id).toBe("2");
  });

  it("counts a booking later today as upcoming", () => {
    expect(pickUpcomingBooking([b("1", "Accepted", "2026-09-25T08:00:00")], NOW)?.id).toBe("1");
  });

  it("falls back to the latest ongoing booking when all are in the past", () => {
    const list = [b("1", "InProgress", "2026-09-20"), b("2", "PendingCompletion", "2026-09-23")];
    expect(pickUpcomingBooking(list, NOW)?.id).toBe("2");
  });

  it("returns null when nothing is ongoing", () => {
    expect(pickUpcomingBooking([b("1", "Completed", "2026-09-30")], NOW)).toBeNull();
  });
});

describe("pickBookAgainWorkers", () => {
  it("lists each past worker once, most recent first", () => {
    const list = [
      b("1", "Completed", "2026-08-01", { workerId: "w1", category: "Plumbing" }),
      b("2", "Completed", "2026-09-01", { workerId: "w2" }),
      b("3", "Completed", "2026-09-10", { workerId: "w1", category: "Plumbing" }),
      b("4", "Accepted", "2026-09-20", { workerId: "w3" }),
      b("5", "Completed", "2026-09-12"),
    ];
    expect(pickBookAgainWorkers(list).map((w) => w.workerId)).toEqual(["w1", "w2"]);
    expect(pickBookAgainWorkers(list)[0].service).toBe("Plumbing");
  });

  it("respects the limit", () => {
    const list = ["a", "b", "c"].map((w, i) => b(w, "Completed", `2026-09-0${i + 1}`, { workerId: w }));
    expect(pickBookAgainWorkers(list, 2)).toHaveLength(2);
  });
});
