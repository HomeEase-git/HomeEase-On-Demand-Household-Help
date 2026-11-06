import React, { useState } from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import ProofPhotosField from "../ProofPhotosField";

const mockInfo = jest.fn();
jest.mock("../../../contexts/AlertModalContext", () => ({
  useAlertModal: () => ({ info: mockInfo, error: jest.fn(), warning: jest.fn() }),
}));
jest.mock("../../icons/AppIcon", () => ({ AppIcon: () => null }));
jest.mock("../../ui/RemoteImage", () => ({ RemoteImage: () => null }));
jest.mock("../../ui/ImageLightbox", () => ({ ImageLightbox: () => null }));
jest.mock("../../../utils/imageCompressor", () => ({
  compressImage: async (uri: string) => ({ uri: `${uri}.small` }),
}));
jest.mock("expo-document-picker", () => ({}));
jest.mock("expo-image-picker", () => ({
  MediaTypeOptions: { Images: "Images" },
  launchImageLibraryAsync: jest.fn(),
}));

function Harness({ upload, initial }: { upload: (uri: string) => Promise<{ url: string }>; initial: string[] }) {
  const [urls, setUrls] = useState(initial);
  return <ProofPhotosField label="Proof" urls={urls} onChange={setUrls} upload={upload} />;
}

describe("ProofPhotosField", () => {
  it("keeps a removal made while another photo uploads", async () => {
    let finish!: (value: { url: string }) => void;
    const upload = jest.fn(() => new Promise<{ url: string }>((resolve) => (finish = resolve)));
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///new.jpg" }],
    });

    const { getByLabelText, getByText, queryByLabelText } = await render(<Harness upload={upload} initial={["a", "b"]} />);
    expect(getByText("2/5")).toBeTruthy();

    await fireEvent.press(getByLabelText("Add a photo: Proof"));
    await act(async () => {
      mockInfo.mock.calls[0][2][1].onPress(); // [Camera, Gallery, Cancel]
    });
    await waitFor(() => expect(upload).toHaveBeenCalledWith("file:///new.jpg.small"));

    await fireEvent.press(getByLabelText("Remove photo 1"));
    await act(async () => finish({ url: "c" }));

    expect(getByText("2/5")).toBeTruthy();
    expect(queryByLabelText("Remove photo 3")).toBeNull();
  });
});
