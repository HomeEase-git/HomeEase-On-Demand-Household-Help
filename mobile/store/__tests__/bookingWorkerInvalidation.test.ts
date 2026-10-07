jest.mock("../../services/api", () => ({ getBookings: jest.fn() }));
jest.mock("../../utils/storage", () => ({
  bookingStorage: { saveDraft: jest.fn(), clearDraft: jest.fn(async () => {}), getDraft: jest.fn() },
}));

import { useBookingStore } from "../bookingStore";

const pickWorker = (extra: object = {}) => {
  useBookingStore.getState().clearDraft();
  useBookingStore.setState((s) => ({
    draft: {
      ...s.draft,
      serviceTaskId: "t1",
      scopeAnswers: { Rooms: "2" },
      workerId: "w1",
      workerName: "Ana",
      workerEstimatedTotal: 900,
      workerUnitPrice: 450,
      ...extra,
    },
  }));
};
const draft = () => useBookingStore.getState().draft;

describe("picked worker vs. changed scope", () => {
  it("is dropped when the task changes, so the old price can't linger", () => {
    pickWorker();
    useBookingStore.getState().setDraft({ serviceTaskId: "t2" });
    expect(draft().workerId).toBeNull();
    expect(draft().workerEstimatedTotal).toBeNull();
  });

  it("is dropped when a scope answer (quantity) changes", () => {
    pickWorker();
    useBookingStore.getState().setDraft({ scopeAnswers: { Rooms: "5" } });
    expect(draft().workerId).toBeNull();
    expect(draft().workerUnitPrice).toBeNull();
  });

  it("is kept when nothing changed", () => {
    pickWorker();
    useBookingStore.getState().setDraft({ serviceTaskId: "t1", scopeAnswers: { Rooms: "2" } });
    expect(draft().workerId).toBe("w1");
    expect(draft().workerEstimatedTotal).toBe(900);
  });

  it("is kept for a locked worker", () => {
    pickWorker({ workerLocked: true });
    useBookingStore.getState().setDraft({ serviceTaskId: "t2" });
    expect(draft().workerId).toBe("w1");
  });
});
