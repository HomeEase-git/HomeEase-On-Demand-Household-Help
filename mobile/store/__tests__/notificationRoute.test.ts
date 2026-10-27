jest.mock("../../services/api", () => ({}));

import { clientNotificationRoute, workerNotificationRoute } from "../notificationStore";

describe("clientNotificationRoute", () => {
  it("opens the booking for booking and payment updates", () => {
    expect(clientNotificationRoute("BOOKING_ACCEPTED", "b1", "n1")).toBe("/(client)/booking/b1");
    expect(clientNotificationRoute("BOOKING_COMPLETED", "b1", "n1")).toBe("/(client)/booking/b1");
    expect(clientNotificationRoute("PAYMENT_REMINDER", "b1", "n1")).toBe("/(client)/booking/b1");
  });
  it("opens the booking for the booking-gap notifications", () => {
    for (const type of ["BOOKING_ARRIVED", "BOOKING_STARTED", "BOOKING_PROBLEM_REPORTED", "BOOKING_CANCEL_REQUESTED", "BOOKING_CLIENT_NOT_HERE", "BOOKING_REMINDER"]) {
      expect(clientNotificationRoute(type, "b1", "n1")).toBe("/(client)/booking/b1");
    }
  });
  it("falls back to the notification screen without a booking", () => {
    expect(clientNotificationRoute("BOOKING_ACCEPTED", undefined, "n1")).toBe("/(client)/inbox/notification/n1");
    expect(clientNotificationRoute("SYSTEM_ANNOUNCEMENT", "x", "n1")).toBe("/(client)/inbox/notification/n1");
  });
});

describe("workerNotificationRoute", () => {
  it("opens the job for booking and payment updates", () => {
    for (const type of ["BOOKING_ARRIVED", "BOOKING_STARTED", "BOOKING_PROBLEM_REPORTED", "BOOKING_CANCEL_REQUESTED", "BOOKING_CLIENT_NOT_HERE", "BOOKING_REMINDER"]) {
      expect(workerNotificationRoute(type, "b1", "n1")).toBe("/(worker)/records/job/b1");
    }
  });
  it("falls back to the notification screen without a booking", () => {
    expect(workerNotificationRoute("BOOKING_REMINDER", undefined, "n1")).toBe("/(worker)/inbox/notification/n1");
    expect(workerNotificationRoute("SYSTEM_ANNOUNCEMENT", "x", "n1")).toBe("/(worker)/inbox/notification/n1");
  });
});
