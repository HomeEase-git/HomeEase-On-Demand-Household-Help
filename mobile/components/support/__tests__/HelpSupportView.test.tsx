import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { HelpSupportView } from "../HelpSupportView";
import { CLIENT_FAQ, WORKER_FAQ } from "../../../constants/supportContent";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));
jest.mock("../../ui/ScreenHeader", () => () => null);

describe("HelpSupportView", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows role-specific FAQs", async () => {
    const client = await render(<HelpSupportView role="client" />);
    expect(client.queryByText("How do I book a service?")).toBeTruthy();
    expect(client.queryByText("How much does HomeEase keep?")).toBeNull();

    const worker = await render(<HelpSupportView role="worker" />);
    expect(worker.queryByText("How much does HomeEase keep?")).toBeTruthy();
    expect(worker.queryByText("How do I book a service?")).toBeNull();
  });

  it("filters by search text and shows an empty state", async () => {
    const { getByPlaceholderText, queryByText } = await render(<HelpSupportView role="client" />);
    await fireEvent.changeText(getByPlaceholderText("Search FAQ..."), "refund");
    expect(queryByText("How do refunds work?")).toBeTruthy();
    expect(queryByText("How do I book a service?")).toBeNull();

    await fireEvent.changeText(getByPlaceholderText("Search FAQ..."), "zzzz-no-match");
    expect(queryByText(/No answers match/)).toBeTruthy();
  });

  it("filters by category chip", async () => {
    const { getByRole, queryByText } = await render(<HelpSupportView role="worker" />);
    await fireEvent.press(getByRole("button", { name: "Earnings & payouts" }));
    expect(queryByText("When do I get paid?")).toBeTruthy();
    expect(queryByText("What documents do I need?")).toBeNull();
  });

  it("expands an answer on tap", async () => {
    const item = CLIENT_FAQ[0].items[0];
    const { getByText, queryByText } = await render(<HelpSupportView role="client" />);
    expect(queryByText(item.a)).toBeNull();
    await fireEvent.press(getByText(item.q));
    expect(queryByText(item.a)).toBeTruthy();
  });

  it("routes Contact Us to the role's own screen", async () => {
    const { getByText } = await render(<HelpSupportView role="worker" />);
    await fireEvent.press(getByText("Contact Us"));
    expect(mockPush).toHaveBeenCalledWith("/(worker)/profile/contact-us");
  });

  it("has no duplicate questions within a role", () => {
    for (const faq of [CLIENT_FAQ, WORKER_FAQ]) {
      const qs = faq.flatMap((c) => c.items.map((i) => i.q));
      expect(new Set(qs).size).toBe(qs.length);
    }
  });
});
