import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import StartTimePicker from "../StartTimePicker";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("StartTimePicker", () => {
  it("emits a 24h time for a typed 12h time, guessing PM for afternoon hours", async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(<StartTimePicker value={null} onChange={onChange} />);
    await fireEvent.changeText(getByLabelText("Hour"), "2");
    await fireEvent.changeText(getByLabelText("Minutes"), "45");
    expect(onChange).toHaveBeenLastCalledWith("14:45");
  });

  it("lets the user switch AM/PM", async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(<StartTimePicker value={null} onChange={onChange} />);
    await fireEvent.changeText(getByLabelText("Hour"), "9");
    await fireEvent.changeText(getByLabelText("Minutes"), "15");
    expect(onChange).toHaveBeenLastCalledWith("09:15");
    await fireEvent.press(getByLabelText("PM"));
    expect(onChange).toHaveBeenLastCalledWith(null); // 9:15 PM is after hours
  });

  it("steps hours and minutes with the arrows", async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(<StartTimePicker value="10:07" onChange={onChange} />);
    await fireEvent.press(getByLabelText("Increase minutes"));
    expect(onChange).toHaveBeenLastCalledWith("10:10");
    await fireEvent.press(getByLabelText("Increase hour"));
    expect(onChange).toHaveBeenLastCalledWith("11:10");
  });

  it("rejects a time before the day's earliest start and explains why", async () => {
    const onChange = jest.fn();
    const { getByLabelText, getByText } = await render(
      <StartTimePicker value={null} onChange={onChange} minTime="13:30" />,
    );
    await fireEvent.changeText(getByLabelText("Hour"), "1");
    await fireEvent.changeText(getByLabelText("Minutes"), "00");
    expect(onChange).not.toHaveBeenCalledWith("13:00");
    expect(getByText("The earliest start on this day is 1:30 PM.")).toBeTruthy();
  });

  it("clears the time when a new date moves the earliest start past it", async () => {
    const onChange = jest.fn();
    const { rerender } = await render(<StartTimePicker value="09:00" onChange={onChange} />);
    await rerender(<StartTimePicker value="09:00" onChange={onChange} minTime="12:00" />);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
