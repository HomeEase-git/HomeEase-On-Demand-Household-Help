jest.mock("../../services/api", () => ({ getBookingsPage: jest.fn() }));
jest.mock("../../utils/storage", () => ({
  bookingStorage: { saveDraft: jest.fn(), clearDraft: jest.fn(async () => {}), getDraft: jest.fn() },
}));

import { getBookingsPage } from "../../services/api";
import { useBookingStore } from "../bookingStore";

const mock = getBookingsPage as jest.Mock;
const row = (id: string) => ({ id, service: "s", status: "PENDING", scheduledDate: "2026-10-07", estimatedPrice: 1 });
const page = (ids: string[], p: number, pages: number) => ({
  bookings: ids.map(row),
  pagination: { page: p, limit: 20, total: 0, pages },
});

beforeEach(() => {
  mock.mockReset();
  useBookingStore.setState({ bookings: [], bookingsPage: 1, bookingsHasMore: false });
});

it("refreshBookings loads page 1 and records whether more pages exist", async () => {
  mock.mockResolvedValue(page(["a"], 1, 2));
  await useBookingStore.getState().refreshBookings();
  expect(mock).toHaveBeenCalledWith(1);
  expect(useBookingStore.getState().bookings.map((b) => b.id)).toEqual(["a"]);
  expect(useBookingStore.getState().bookingsHasMore).toBe(true);
});

it("loadMoreBookings appends the next page, skipping duplicates", async () => {
  mock.mockResolvedValueOnce(page(["a", "b"], 1, 2)).mockResolvedValueOnce(page(["b", "c"], 2, 2));
  await useBookingStore.getState().refreshBookings();
  await useBookingStore.getState().loadMoreBookings();
  expect(mock).toHaveBeenLastCalledWith(2);
  const s = useBookingStore.getState();
  expect(s.bookings.map((b) => b.id)).toEqual(["a", "b", "c"]);
  expect(s.bookingsHasMore).toBe(false);
});

it("drops a load-more that lands after a refresh reset the list", async () => {
  useBookingStore.setState({ bookings: [], bookingsPage: 2, bookingsHasMore: true });
  let resolveOld!: (v: unknown) => void;
  mock.mockReturnValueOnce(new Promise((r) => (resolveOld = r))).mockResolvedValueOnce(page(["a"], 1, 3));

  const more = useBookingStore.getState().loadMoreBookings();
  await useBookingStore.getState().refreshBookings();
  resolveOld(page(["z"], 3, 3));
  await more;

  const s = useBookingStore.getState();
  expect(s.bookings.map((b) => b.id)).toEqual(["a"]);
  expect(s.bookingsPage).toBe(1);
});
