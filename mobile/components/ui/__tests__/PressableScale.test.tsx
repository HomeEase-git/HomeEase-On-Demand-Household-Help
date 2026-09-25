import React from "react";
import { Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { PressableScale } from "../PressableScale";

describe("PressableScale", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls onPress", async () => {
    const onPress = jest.fn();
    const { getByText } = await render(
      <PressableScale onPress={onPress}>
        <Text>Go</Text>
      </PressableScale>,
    );
    await fireEvent.press(getByText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("vibrates only when haptic is on", async () => {
    const { getByText } = await render(
      <>
        <PressableScale onPress={() => {}}>
          <Text>Quiet</Text>
        </PressableScale>
        <PressableScale haptic onPress={() => {}}>
          <Text>Buzz</Text>
        </PressableScale>
      </>,
    );
    await fireEvent.press(getByText("Quiet"));
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    await fireEvent.press(getByText("Buzz"));
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it("stays silent when inert but still forwards the press", async () => {
    // Inert buttons keep their Pressable enabled (Android touch fix) and
    // guard in their own handler, so the press must still reach onPress.
    const onPress = jest.fn();
    const { getByText } = await render(
      <PressableScale haptic inert onPress={onPress}>
        <Text>Disabled look</Text>
      </PressableScale>,
    );
    await fireEvent.press(getByText("Disabled look"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });
});
