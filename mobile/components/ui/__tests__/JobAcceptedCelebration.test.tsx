import React from "react";
import { act, render } from "@testing-library/react-native";
import JobAcceptedCelebration from "../JobAcceptedCelebration";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

// Reanimated's native runtime isn't available under Jest, and this test is about
// the component's timing, not its motion: stand in values that apply instantly.
jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: { View },
    Easing: { out: () => () => 0, cubic: () => 0 },
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (factory: () => object) => factory(),
    useReducedMotion: () => false,
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
    withDelay: (_delay: number, value: number) => value,
  };
});

// The first test pays for loading react-native's modules, which can exceed the 5s default.
jest.setTimeout(60000);

describe("JobAcceptedCelebration", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows the title and message, then calls onFinish once after the duration", async () => {
    const onFinish = jest.fn();
    const { getByText } = await render(
      <JobAcceptedCelebration visible onFinish={onFinish} durationMs={1000} />,
    );
    expect(getByText("Job Accepted!")).toBeTruthy();
    expect(getByText("The client has been notified.")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(999);
    });
    expect(onFinish).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("does nothing while hidden", async () => {
    const onFinish = jest.fn();
    await render(<JobAcceptedCelebration visible={false} onFinish={onFinish} durationMs={500} />);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("cancels the pending finish if it is hidden or unmounted first", async () => {
    const onFinish = jest.fn();
    const { unmount } = await render(<JobAcceptedCelebration visible onFinish={onFinish} durationMs={500} />);
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(onFinish).not.toHaveBeenCalled();
  });
});
