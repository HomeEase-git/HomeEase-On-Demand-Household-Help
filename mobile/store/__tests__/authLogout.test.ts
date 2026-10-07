jest.mock("../../services/notificationService", () => ({
  notificationService: { clearTokenFromBackend: jest.fn(async () => {}) },
}));
jest.mock("../../services/api", () => ({
  postLogout: jest.fn(async () => {}),
  getBookings: jest.fn(),
}));
jest.mock("../../utils/storage", () => ({
  authStorage: { saveUser: jest.fn(), saveToken: jest.fn(), saveRefreshToken: jest.fn(), clearAuth: jest.fn(async () => {}) },
  bookingStorage: { saveDraft: jest.fn(), clearDraft: jest.fn(async () => {}), getDraft: jest.fn() },
}));

import { useAuthStore } from "../authStore";
import { useBookingStore } from "../bookingStore";
import { useMessageStore } from "../messageStore";
import { useNotificationStore } from "../notificationStore";
import { bookingStorage } from "../../utils/storage";

describe("logout", () => {
  it("drops the previous account's cached data and booking draft", async () => {
    useBookingStore.setState({ bookings: [{ id: "b1" } as any], selectedBooking: { id: "b1" } as any });
    useBookingStore.getState().setDraft({ paymentAccountIdentifier: "09171234567" });
    useMessageStore.setState({ conversations: [{ userId: "u2" } as any], messagesByUser: { u2: [] } });
    useNotificationStore.setState({ notifications: [{ id: "n1" } as any], unreadCount: 1 });

    await useAuthStore.getState().logout();

    expect(useBookingStore.getState().bookings).toEqual([]);
    expect(useBookingStore.getState().selectedBooking).toBeNull();
    expect(useBookingStore.getState().draft.paymentAccountIdentifier).toBeNull();
    expect(bookingStorage.clearDraft).toHaveBeenCalled();
    expect(useMessageStore.getState().conversations).toEqual([]);
    expect(useMessageStore.getState().messagesByUser).toEqual({});
    expect(useNotificationStore.getState().notifications).toEqual([]);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
  });
});
