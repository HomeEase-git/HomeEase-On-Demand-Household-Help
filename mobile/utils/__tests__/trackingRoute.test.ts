jest.mock("expo-location", () => ({}));
jest.mock("../../services/api", () => ({}));

import { shouldRefetchRoute, remainingMinutes } from "../trackingRoute";

const origin = { lat: 14.5995, lng: 120.9842 };
// ~330 m north
const moved = { lat: 14.6025, lng: 120.9842 };
// ~55 m north
const nudged = { lat: 14.6, lng: 120.9842 };

describe("shouldRefetchRoute", () => {
  it("fetches the first route right away", () => {
    expect(shouldRefetchRoute(null, origin, 0)).toBe(true);
  });

  it("waits 60 s even after a big move", () => {
    expect(shouldRefetchRoute({ at: 0, from: origin }, moved, 59_000)).toBe(false);
    expect(shouldRefetchRoute({ at: 0, from: origin }, moved, 60_000)).toBe(true);
  });

  it("skips a worker who has barely moved, however long it's been", () => {
    expect(shouldRefetchRoute({ at: 0, from: origin }, nudged, 10 * 60_000)).toBe(false);
  });
});

describe("remainingMinutes", () => {
  it("counts down from when the route was fetched and never goes negative", () => {
    expect(remainingMinutes({ durationMin: 12, fetchedAt: 0 }, 0)).toBe(12);
    expect(remainingMinutes({ durationMin: 12, fetchedAt: 0 }, 5 * 60_000)).toBe(7);
    expect(remainingMinutes({ durationMin: 12, fetchedAt: 0 }, 30 * 60_000)).toBe(0);
  });
});

describe("shouldRefetchRoute after a failed request", () => {
  it("retries after 60 s even if the worker hasn't moved", () => {
    expect(shouldRefetchRoute({ at: 0, from: null }, origin, 59_000)).toBe(false);
    expect(shouldRefetchRoute({ at: 0, from: null }, origin, 60_000)).toBe(true);
  });
});
