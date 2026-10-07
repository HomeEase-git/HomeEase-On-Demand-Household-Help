jest.mock("../../services/api", () => ({
  getNotifications: jest.fn(),
  getUnreadNotificationCount: jest.fn(),
}));

import * as api from "../../services/api";
import { useNotificationStore, type Notification } from "../notificationStore";

const n = (id: string): Notification => ({
  id, title: "t", message: "m", type: "BOOKING_ACCEPTED", relatedId: null, isRead: false,
  createdAt: "2026-10-07T00:00:00.000Z",
});
const getNotifications = api.getNotifications as jest.Mock;
const page = (ids: string[], p: number, pages: number) => ({
  notifications: ids.map(n),
  pagination: { page: p, limit: 20, total: 0, pages },
});

beforeEach(() => {
  jest.resetAllMocks();
  useNotificationStore.setState({ notifications: [], unreadCount: 0, page: 1, hasMore: false });
});

it("takes the unread count from the server, not just page 1", async () => {
  getNotifications.mockResolvedValue(page(["a"], 1, 3));
  (api.getUnreadNotificationCount as jest.Mock).mockResolvedValue(42);
  await useNotificationStore.getState().fetchNotifications();
  expect(useNotificationStore.getState().unreadCount).toBe(42);
  expect(useNotificationStore.getState().hasMore).toBe(true);
});

it("loadMore appends the next page without duplicates and stops at the last page", async () => {
  useNotificationStore.setState({ notifications: [n("a"), n("b")], page: 1, hasMore: true });
  getNotifications.mockResolvedValue(page(["b", "c"], 2, 2));
  await useNotificationStore.getState().loadMore();

  expect(getNotifications).toHaveBeenCalledWith(2);
  const s = useNotificationStore.getState();
  expect(s.notifications.map((x) => x.id)).toEqual(["a", "b", "c"]);
  expect(s.hasMore).toBe(false);

  await s.loadMore();
  expect(getNotifications).toHaveBeenCalledTimes(1);
});
