jest.mock("../../services/api", () => ({}));

import { clientNotificationRoute } from "../notificationStore";

describe("clientNotificationRoute", () => {
  it("opens the quote for a submitted quote", () => {
    expect(clientNotificationRoute("QUOTE_SUBMITTED", "b1", "n1")).toBe("/(client)/booking/b1/quote");
    expect(clientNotificationRoute("QUOTE_REMINDER", "b1", "n1")).toBe("/(client)/booking/b1/quote");
  });
  it("opens the booking for booking and payment updates", () => {
    expect(clientNotificationRoute("BOOKING_ACCEPTED", "b1", "n1")).toBe("/(client)/booking/b1");
    expect(clientNotificationRoute("PAYMENT_REMINDER", "b1", "n1")).toBe("/(client)/booking/b1");
  });
  it("falls back to the notification screen without a booking", () => {
    expect(clientNotificationRoute("BOOKING_ACCEPTED", undefined, "n1")).toBe("/(client)/inbox/notification/n1");
    expect(clientNotificationRoute("SYSTEM_ANNOUNCEMENT", "x", "n1")).toBe("/(client)/inbox/notification/n1");
  });
});
