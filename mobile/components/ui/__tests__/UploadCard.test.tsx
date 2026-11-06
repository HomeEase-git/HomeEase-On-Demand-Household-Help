import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { UploadCard } from "../UploadCard";

jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));
jest.mock("../RemoteImage", () => ({ RemoteImage: () => null }));
jest.mock("../ImageLightbox", () => {
  const { Text } = require("react-native");
  return { ImageLightbox: ({ uri }: { uri: string | null }) => (uri ? <Text>viewer: {uri}</Text> : null) };
});

describe("UploadCard", () => {
  it("asks for a file while empty", async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<UploadCard label="ID front" required onPress={onPress} />);
    expect(getByText("Required")).toBeTruthy();
    await fireEvent.press(getByText("Tap to add a photo"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("opens the photo without starting a replace", async () => {
    const onPress = jest.fn();
    const { getByLabelText, getByText, queryByText } = await render(
      <UploadCard label="ID front" required imageUri="file:///id.jpg" onPress={onPress} />,
    );
    expect(queryByText("Required")).toBeNull();
    await fireEvent.press(getByLabelText("View ID front full size"));
    expect(getByText("viewer: file:///id.jpg")).toBeTruthy();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("replaces only through the Replace button", async () => {
    const onPress = jest.fn();
    const { getByLabelText } = await render(<UploadCard label="ID front" imageUri="file:///id.jpg" onPress={onPress} />);
    await fireEvent.press(getByLabelText("Replace ID front"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("blocks viewing and replacing during an upload", async () => {
    const onPress = jest.fn();
    const { getByLabelText, getByText, queryByText } = await render(
      <UploadCard label="ID front" imageUri="file:///id.jpg" uploading onPress={onPress} />,
    );
    expect(getByText("Uploading…")).toBeTruthy();
    await fireEvent.press(getByLabelText("View ID front full size"));
    await fireEvent.press(getByLabelText("Replace ID front"));
    expect(queryByText("viewer: file:///id.jpg")).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("shows a file with no image by name", async () => {
    const { getByText, queryByLabelText } = await render(<UploadCard label="NBI" preview="nbi.pdf" onPress={jest.fn()} />);
    expect(getByText("nbi.pdf")).toBeTruthy();
    expect(queryByLabelText("View NBI full size")).toBeNull();
  });
});
