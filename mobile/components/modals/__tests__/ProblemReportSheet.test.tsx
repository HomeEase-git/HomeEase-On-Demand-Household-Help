import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { ProblemReportSheet } from "../ProblemReportSheet";

jest.mock("../ModalWrapper", () => ({
  __esModule: true,
  default: ({ children }: any) => children,
}));
jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));

const base = { visible: true, workerArrived: false, inProgress: false, onSend: jest.fn(), onCancel: jest.fn() };

describe("ProblemReportSheet", () => {
  beforeEach(() => base.onSend.mockClear());

  it("sends the picked reason with no note", async () => {
    const { getByText } = await render(<ProblemReportSheet {...base} />);
    await fireEvent.press(getByText("I need to cancel"));
    await fireEvent.press(getByText("Send"));
    expect(base.onSend).toHaveBeenCalledWith("NEED_TO_CANCEL", undefined);
  });

  it("keeps Send disabled until a chip is picked", async () => {
    const { getByText } = await render(<ProblemReportSheet {...base} />);
    await fireEvent.press(getByText("Send"));
    expect(base.onSend).not.toHaveBeenCalled();
  });

  it("needs a 10 character note for Other", async () => {
    const { getByText, getByPlaceholderText } = await render(<ProblemReportSheet {...base} />);
    await fireEvent.press(getByText("Other"));
    await fireEvent.changeText(getByPlaceholderText("What happened?"), "abc");
    await fireEvent.press(getByText("Send"));
    expect(base.onSend).not.toHaveBeenCalled();
    await fireEvent.changeText(getByPlaceholderText("What happened?"), "worker was rude");
    await fireEvent.press(getByText("Send"));
    expect(base.onSend).toHaveBeenCalledWith("OTHER", "worker was rude");
  });

  it("hides chips that do not apply", async () => {
    const { queryByText, rerender } = await render(<ProblemReportSheet {...base} workerArrived />);
    expect(queryByText("Worker isn't here")).toBeNull();
    expect(queryByText("Worker stopped working")).toBeNull();
    await rerender(<ProblemReportSheet {...base} inProgress />);
    expect(queryByText("Worker stopped working")).not.toBeNull();
  });

  it("starts clean when reopened", async () => {
    const { getByText, rerender } = await render(<ProblemReportSheet {...base} />);
    await fireEvent.press(getByText("I need to cancel"));
    await rerender(<ProblemReportSheet {...base} visible={false} />);
    await rerender(<ProblemReportSheet {...base} />);
    await fireEvent.press(getByText("Send"));
    expect(base.onSend).not.toHaveBeenCalled();
  });
});
