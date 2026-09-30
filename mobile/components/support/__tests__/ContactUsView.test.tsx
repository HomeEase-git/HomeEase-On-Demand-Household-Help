import React from "react";
import { Linking } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { ContactUsView } from "../ContactUsView";
import { SUPPORT_CHANNELS } from "../../../constants/supportContent";

const mockBack = jest.fn();
const mockError = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), back: mockBack }) }));
jest.mock("expo-constants", () => ({ expoConfig: { version: "9.9.9" } }));
jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));
jest.mock("../../ui/ScreenHeader", () => () => null);
jest.mock("../../ui/KeyboardAwareScrollView", () => {
  const { ScrollView } = require("react-native");
  return { KeyboardAwareScrollView: ScrollView };
});
jest.mock("../../../contexts/AlertModalContext", () => ({
  useAlertModal: () => ({ error: mockError }),
}));
jest.mock("../../../store/authStore", () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: { id: "user-123", email: "jane@example.com" } }),
}));

const decode = (url: string) => {
  const [, query] = url.split("?");
  const params = new URLSearchParams(query);
  return { to: url.split("?")[0], subject: params.get("subject"), body: params.get("body") };
};

describe("ContactUsView", () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  });

  it("requires a topic and a message", async () => {
    const { getByText, getByPlaceholderText } = await render(<ContactUsView role="client" />);
    await fireEvent.press(getByText("Send via Email"));
    expect(mockError).toHaveBeenCalledWith("Choose a topic", expect.any(String));

    await fireEvent.press(getByText("Booking"));
    await fireEvent.press(getByText("Send via Email"));
    expect(mockError).toHaveBeenCalledWith("Message required", expect.any(String));
    expect(openURL).not.toHaveBeenCalled();

    await fireEvent.changeText(getByPlaceholderText("Tell us what happened..."), "Help");
    await fireEvent.press(getByText("Send via Email"));
    expect(openURL).toHaveBeenCalledTimes(1);
  });

  it("builds the email with topic, booking ID and account details", async () => {
    const { getByText, getByPlaceholderText } = await render(<ContactUsView role="worker" />);
    await fireEvent.press(getByText("Payouts or dues"));
    await fireEvent.changeText(getByPlaceholderText("e.g. #A1B2C3"), "#ABC123");
    await fireEvent.changeText(getByPlaceholderText("Short summary"), "Missing payout");
    await fireEvent.changeText(getByPlaceholderText("Tell us what happened..."), "Not paid yet");
    await fireEvent.press(getByText("Send via Email"));

    const mail = decode(openURL.mock.calls[0][0]);
    expect(mail.to).toBe(`mailto:${SUPPORT_CHANNELS.email}`);
    expect(mail.subject).toBe("[Payouts or dues] Missing payout");
    expect(mail.body).toContain("Not paid yet");
    expect(mail.body).toContain("Account: jane@example.com (worker, ID user-123)");
    expect(mail.body).toContain("Booking ID: #ABC123");
    expect(mail.body).toContain("App version: 9.9.9");
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it("uses the topic as subject when none is given", async () => {
    const { getByText, getByPlaceholderText } = await render(<ContactUsView role="client" />);
    await fireEvent.press(getByText("App problem"));
    await fireEvent.changeText(getByPlaceholderText("Tell us what happened..."), "Crash");
    await fireEvent.press(getByText("Send via Email"));
    expect(decode(openURL.mock.calls[0][0]).subject).toBe("[App problem] App problem");
  });

  it("shows the email address when no mail app opens", async () => {
    openURL.mockRejectedValueOnce(new Error("no handler"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const { getByText, getByPlaceholderText } = await render(<ContactUsView role="client" />);
    await fireEvent.press(getByText("Other"));
    await fireEvent.changeText(getByPlaceholderText("Tell us what happened..."), "Hi");
    await fireEvent.press(getByText("Send via Email"));
    await waitFor(() =>
      expect(mockError).toHaveBeenCalledWith(
        "No email app found",
        expect.stringContaining(SUPPORT_CHANNELS.email),
      ),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("hides the phone row until a real number is configured", async () => {
    const { queryByText } = await render(<ContactUsView role="client" />);
    expect(SUPPORT_CHANNELS.phone).toBeNull();
    expect(queryByText("Phone")).toBeNull();
  });
});
