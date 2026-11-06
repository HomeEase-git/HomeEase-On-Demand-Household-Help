import { useCallback } from "react";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useAlertModal } from "../contexts/AlertModalContext";
import { compressImage } from "../utils/imageCompressor";

export type MediaSource = "camera" | "gallery" | "files";

export type PickedMedia = {
  uri: string;
  /** Type of the file at `uri`. An image is re-encoded, so this is image/jpeg. */
  mimeType: string;
  /** Type the picker reported, before any re-encoding. */
  originalMimeType: string;
  name: string;
};

type PickOptions = {
  title: string;
  message?: string;
  /** Shown in this order. A single source skips the choice and opens it. */
  sources?: MediaSource[];
  /** Types the Files source accepts. */
  fileTypes?: string[];
  onPick: (media: PickedMedia) => void | Promise<void>;
};

const SOURCE_LABEL: Record<MediaSource, string> = { camera: "Camera", gallery: "Gallery", files: "Files" };

/**
 * The one way the app picks a photo or file: asks Camera / Gallery / Files in
 * the alert modal, never crops, and shrinks images to 1600px JPEG (the upload
 * endpoints take JPEG/PNG/WebP up to 5 MB, and phone photos are 3-12 MB, often
 * HEIC). PDFs pass through untouched.
 */
export function useMediaPicker() {
  const alertModal = useAlertModal();

  const finish = useCallback(
    async (
      uri: string,
      mimeType: string,
      name: string,
      size: { width?: number; height?: number } | undefined,
      onPick: PickOptions["onPick"],
    ) => {
      let finalUri = uri;
      let finalMime = mimeType;
      if (mimeType.startsWith("image/")) {
        try {
          finalUri = (await compressImage(uri, 1600, 0.7, size)).uri;
          finalMime = "image/jpeg";
        } catch {
          // Upload the original if compression fails.
        }
      }
      await onPick({ uri: finalUri, mimeType: finalMime, originalMimeType: mimeType, name });
    },
    [],
  );

  const open = useCallback(
    async (source: MediaSource, { fileTypes, onPick }: PickOptions) => {
      try {
        if (source === "files") {
          const result = await DocumentPicker.getDocumentAsync({
            type: fileTypes ?? ["application/pdf", "image/*"],
            copyToCacheDirectory: true,
          });
          const file = result.canceled ? null : result.assets?.[0];
          if (file?.uri) {
            await finish(file.uri, file.mimeType || "application/octet-stream", file.name || "file", undefined, onPick);
          }
          return;
        }

        if (source === "camera") {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            alertModal.warning("Permission required", "Camera access is needed to take a photo.");
            return;
          }
        }
        // No allowsEditing: the photo is used as taken, with no crop step.
        const options: ImagePicker.ImagePickerOptions = {
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        };
        const result =
          source === "camera"
            ? await ImagePicker.launchCameraAsync(options)
            : await ImagePicker.launchImageLibraryAsync(options);
        const asset = result.canceled ? null : result.assets[0];
        if (asset) {
          await finish(asset.uri, asset.mimeType || "image/jpeg", asset.fileName || "photo.jpg", asset, onPick);
        }
      } catch (error) {
        console.error("Media pick error:", error);
        alertModal.error("Error", "Something went wrong while opening that. Please try again.");
      }
    },
    [alertModal, finish],
  );

  const pick = useCallback(
    (options: PickOptions) => {
      const sources = options.sources ?? ["camera", "gallery"];
      if (sources.length === 1) {
        void open(sources[0], options);
        return;
      }
      alertModal.info(options.title, options.message, [
        ...sources.map((source) => ({ text: SOURCE_LABEL[source], onPress: () => void open(source, options) })),
        { text: "Cancel", style: "cancel" as const },
      ]);
    },
    [alertModal, open],
  );

  /** Camera or Gallery; hands back just the (compressed) image URI. */
  const pickImage = useCallback(
    (title: string, onSelect: (uri: string) => void | Promise<void>) =>
      pick({ title, onPick: (media) => onSelect(media.uri) }),
    [pick],
  );

  return { pick, pickImage };
}
