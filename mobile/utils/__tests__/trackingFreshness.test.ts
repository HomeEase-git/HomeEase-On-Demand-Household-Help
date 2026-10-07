import { isLiveFresh } from "../trackingFreshness";

const NOW = Date.parse("2026-10-07T10:00:00.000Z");

describe("isLiveFresh", () => {
  it("accepts a position from a minute ago", () => {
    expect(isLiveFresh("2026-10-07T09:59:00.000Z", NOW)).toBe(true);
  });

  it("rejects a position from yesterday's job", () => {
    expect(isLiveFresh("2026-10-06T09:59:00.000Z", NOW)).toBe(false);
  });

  it("rejects a missing or invalid timestamp", () => {
    expect(isLiveFresh(null, NOW)).toBe(false);
    expect(isLiveFresh("nope", NOW)).toBe(false);
  });
});
