jest.mock("../../services/api", () => ({ getBookings: jest.fn() }));
jest.mock("../../utils/storage", () => ({
  bookingStorage: { saveDraft: jest.fn(), clearDraft: jest.fn(async () => {}), getDraft: jest.fn() },
}));

import { useBookingStore } from "../bookingStore";

const setKey = () => useBookingStore.setState((s) => ({ draft: { ...s.draft, idempotencyKey: "k1" } }));
const key = () => useBookingStore.getState().draft.idempotencyKey;

describe("draft idempotency key", () => {
  it.each([
    ["tip", { tip: 50 }],
    ["packages", { selectedPackageIds: ["p1"] }],
    ["worker", { workerId: "w1" }],
    ["payment method", { paymentMethod: "gcash" }],
    ["scope answers", { scopeAnswers: { Rooms: "3" } }],
    ["task", { serviceTaskId: "t1" }],
  ])("is dropped when %s changes after a submit attempt", (_name, patch) => {
    useBookingStore.getState().clearDraft();
    setKey();
    useBookingStore.getState().setDraft(patch as any);
    expect(key()).toBeNull();
  });

  it("survives a setDraft that changes nothing", () => {
    useBookingStore.getState().clearDraft();
    setKey();
    useBookingStore.getState().setDraft({ tip: 0 });
    expect(key()).toBe("k1");
  });
});
