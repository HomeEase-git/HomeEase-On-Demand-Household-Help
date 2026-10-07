jest.mock("../../services/api", () => ({}));

import { useNotificationStore, type Notification } from "../notificationStore";

const n = (over: Partial<Notification> = {}): Notification => ({
  id: "n1",
  title: "t",
  message: "m",
  type: "BOOKING_ACCEPTED",
  relatedId: null,
  isRead: false,
  createdAt: "2026-10-07T00:00:00.000Z",
  ...over,
});

describe("receiveNotification", () => {
  beforeEach(() => useNotificationStore.setState({ notifications: [], unreadCount: 0 }));

  it("does not list or count the same notification twice (push + socket)", () => {
    const { receiveNotification } = useNotificationStore.getState();
    receiveNotification(n());
    receiveNotification(n({ relatedId: "b1" }));

    const s = useNotificationStore.getState();
    expect(s.notifications).toHaveLength(1);
    expect(s.unreadCount).toBe(1);
  });

  it("keeps the copy that knows its booking, whichever arrives last", () => {
    const { receiveNotification } = useNotificationStore.getState();
    receiveNotification(n({ relatedId: "b1" }));
    receiveNotification(n({ relatedId: null }));

    expect(useNotificationStore.getState().notifications[0].relatedId).toBe("b1");
  });
});
