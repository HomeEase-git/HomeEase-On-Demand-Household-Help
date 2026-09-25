import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { KeyboardController } from "react-native-keyboard-controller";
import { InputField } from "../InputField";

jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));

describe("InputField keyboard submit", () => {
  beforeEach(() => jest.clearAllMocks());

  it('moves focus to the next field when returnKeyType is "next"', async () => {
    const { getByPlaceholderText } = await render(
      <InputField label="Street" placeholder="street" value="" onChangeText={() => {}} returnKeyType="next" />,
    );
    await fireEvent(getByPlaceholderText("street"), "submitEditing");
    expect(KeyboardController.setFocusTo).toHaveBeenCalledWith("next");
  });

  it("lets a screen's own onSubmitEditing win", async () => {
    const onSubmit = jest.fn();
    const { getByPlaceholderText } = await render(
      <InputField
        label="Password"
        placeholder="pw"
        value=""
        onChangeText={() => {}}
        returnKeyType="next"
        onSubmitEditing={onSubmit}
      />,
    );
    await fireEvent(getByPlaceholderText("pw"), "submitEditing");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(KeyboardController.setFocusTo).not.toHaveBeenCalled();
  });

  it("does nothing special for other return keys", async () => {
    const { getByPlaceholderText } = await render(
      <InputField label="City" placeholder="city" value="" onChangeText={() => {}} returnKeyType="done" />,
    );
    await fireEvent(getByPlaceholderText("city"), "submitEditing");
    expect(KeyboardController.setFocusTo).not.toHaveBeenCalled();
  });
});
