jest.mock("../../services/api", () => ({ getBookings: jest.fn() }));
jest.mock("../storage", () => ({ bookingStorage: {} }));

import { mapApiBookingDetail, type ApiBookingDetail } from "../mapBookingDetail";

const base = {
  id: "b1",
  worker: null,
  service: "Plumbing",
  status: "QUOTE_SUBMITTED",
  location: "Somewhere",
  scheduledDate: "2026-10-07T00:00:00.000Z",
  scheduledTime: "09:00",
  estimatedPrice: 500,
  finalPrice: null,
  payment: null,
  review: null,
} as unknown as ApiBookingDetail;

describe("mapApiBookingDetail quote total", () => {
  it("falls back to labor + materials when finalPrice is not set yet", () => {
    const b = mapApiBookingDetail({
      ...base,
      quote: { laborCost: 500, materialsCost: 120, notes: null, quotedAt: null },
    });
    expect(b.quote?.totalAmount).toBe(620);
  });

  it("prefers finalPrice", () => {
    const b = mapApiBookingDetail({
      ...base,
      finalPrice: 700,
      quote: { laborCost: 500, materialsCost: 120, notes: null, quotedAt: null },
    });
    expect(b.quote?.totalAmount).toBe(700);
  });
});
