jest.mock("../../services/api", () => ({ getBookings: jest.fn() }));
jest.mock("../storage", () => ({ bookingStorage: {} }));

import { mapApiBookingDetail, type ApiBookingDetail } from "../mapBookingDetail";

const base = {
  id: "b1",
  worker: null,
  service: "Outlet Installation",
  status: "PENDING_COMPLETION",
  location: "Somewhere",
  scheduledDate: "2026-10-07T00:00:00.000Z",
  scheduledTime: "09:00",
  estimatedPrice: 500,
  finalPrice: null,
  payment: null,
  review: null,
} as unknown as ApiBookingDetail;

describe("mapApiBookingDetail amount", () => {
  it("falls back to the booked price before the invoice total is set", () => {
    expect(mapApiBookingDetail(base).amount).toBe(500);
  });

  it("prefers the invoice total (finalPrice) once it's sent", () => {
    expect(mapApiBookingDetail({ ...base, finalPrice: 920 }).amount).toBe(920);
  });

  it("maps a sent invoice to Payment due", () => {
    expect(mapApiBookingDetail(base).status).toBe("PendingCompletion");
  });
});
