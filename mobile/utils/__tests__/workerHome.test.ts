import { pickNextJob, weeklyEarnings, directionsUrl } from "../workerHome";
import type { WorkerJob } from "../../store/workerStore";

const job = (id: string, status: WorkerJob["status"], scheduledDate: string) =>
  ({ id, status, scheduledDate, service: "Plumbing", clientName: "C" }) as WorkerJob;

const NOW = new Date(2026, 8, 25, 10); // 25 Sep 2026, 10:00 local

describe("pickNextJob", () => {
  it("picks the soonest committed job from today on", () => {
    const jobs = [
      job("a", "Accepted", "2026-10-01"),
      job("b", "Pending", "2026-09-26"), // a request, not committed yet
      job("c", "InProgress", "2026-09-27"),
      job("d", "Completed", "2026-09-26"),
    ];
    expect(pickNextJob(jobs, NOW)?.id).toBe("c");
  });

  it("falls back to the latest unfinished job started earlier", () => {
    expect(pickNextJob([job("a", "InProgress", "2026-09-20"), job("b", "QuoteApproved", "2026-09-22")], NOW)?.id).toBe("b");
  });

  it("returns null with nothing committed", () => {
    expect(pickNextJob([job("a", "Pending", "2026-09-30")], NOW)).toBeNull();
  });
});

describe("weeklyEarnings", () => {
  it("gives the 7 days ending today with completed totals per day", () => {
    const days = weeklyEarnings(
      [
        { amount: 500, status: "Completed", date: new Date(2026, 8, 25, 9).toISOString() },
        { amount: 250, status: "Completed", date: new Date(2026, 8, 25, 8).toISOString() },
        { amount: 900, status: "Pending", date: new Date(2026, 8, 25, 8).toISOString() },
        { amount: 300, status: "Completed", date: new Date(2026, 8, 19, 12).toISOString() },
        { amount: 999, status: "Completed", date: new Date(2026, 8, 18, 12).toISOString() }, // 8 days ago
      ],
      NOW,
    );
    expect(days).toHaveLength(7);
    expect(days[6]).toMatchObject({ isToday: true, total: 750 });
    expect(days[0].total).toBe(300);
    expect(days.reduce((s, d) => s + d.total, 0)).toBe(1050);
  });
});

describe("directionsUrl", () => {
  it("encodes the address for Google Maps", () => {
    expect(directionsUrl("12 Rizal St, Malolos")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=12%20Rizal%20St%2C%20Malolos",
    );
  });
});
