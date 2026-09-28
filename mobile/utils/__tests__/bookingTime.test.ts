import { earliestStartTime, isSelectableStartTime } from "../bookingTime";

// 2026-09-27 10:32 in the Philippines (UTC+8).
const NOW = new Date("2026-09-27T02:32:00Z");

describe("earliestStartTime", () => {
  it("is 7:00 AM on a future date", () => {
    expect(earliestStartTime("2026-09-28", 2, NOW)).toBe("07:00");
  });

  it("is the lead time from now, rounded up to 5 minutes, today", () => {
    expect(earliestStartTime("2026-09-27", 2, NOW)).toBe("12:35");
    expect(earliestStartTime("2026-09-27", 0, NOW)).toBe("10:35");
  });

  it("never goes before 7:00 AM", () => {
    expect(earliestStartTime("2026-09-27", 2, new Date("2026-09-26T20:00:00Z"))).toBe("07:00");
  });

  it("is null once no start is left today", () => {
    expect(earliestStartTime("2026-09-27", 2, new Date("2026-09-27T08:30:00Z"))).toBeNull();
    expect(earliestStartTime("2026-09-27", 2, new Date("2026-09-27T15:30:00Z"))).toBeNull();
  });
});

describe("isSelectableStartTime", () => {
  it("accepts any minute between the earliest start and 6:00 PM", () => {
    expect(isSelectableStartTime("2026-09-28", "07:00", 2, NOW)).toBe(true);
    expect(isSelectableStartTime("2026-09-28", "09:47", 2, NOW)).toBe(true);
    expect(isSelectableStartTime("2026-09-28", "18:00", 2, NOW)).toBe(true);
    expect(isSelectableStartTime("2026-09-28", "18:01", 2, NOW)).toBe(false);
    expect(isSelectableStartTime("2026-09-28", "06:59", 2, NOW)).toBe(false);
    expect(isSelectableStartTime("2026-09-27", "12:30", 2, NOW)).toBe(false);
    expect(isSelectableStartTime("2026-09-27", "12:35", 2, NOW)).toBe(true);
    expect(isSelectableStartTime("2026-09-28", null, 2, NOW)).toBe(false);
  });
});
