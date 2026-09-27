import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { RemoteImage } from "../ui/RemoteImage";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { uploadJobPhoto } from "../../services/api";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { compressImage } from "../../utils/imageCompressor";
import { colors } from "../../constants";

type Props = {
  bookingId: string;
  label: string;
  hint?: string;
  urls: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  required?: boolean;
};

/**
 * A row of uploaded evidence photos for a job (quote receipts, materials in
 * use, proof for a cancellation). Each photo uploads straight away; the
 * parent gets the stored URLs. Camera or gallery is chosen in the alert
 * modal (not a bottom sheet) so several of these can sit in one form.
 */
export default function ProofPhotosField({ bookingId, label, hint, urls, onChange, max = 5, required }: Props) {
  const alertModal = useAlertModal();
  const [uploading, setUploading] = useState(false);

  const upload = async (uri: string) => {
    setUploading(true);
    try {
      let uploadUri = uri;
      try {
        uploadUri = (await compressImage(uri)).uri;
      } catch {
        // Upload the original if compression fails.
      }
      const { url } = await uploadJobPhoto(bookingId, uploadUri, "image/jpeg");
      onChange([...urls, url]);
    } catch (error) {
      console.error("Upload proof photo error:", error);
      alertModal.error("Upload failed", "We couldn't upload that photo. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const pick = async (source: "camera" | "gallery") => {
    try {
      if (source === "camera") {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          alertModal.warning("Permission required", "Camera access is needed to take a photo.");
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 };
      const result =
        source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled && result.assets[0]) await upload(result.assets[0].uri);
    } catch {
      alertModal.error("Error", "Something went wrong while opening the camera or gallery. Please try again.");
    }
  };

  const choose = () =>
    alertModal.showAlert({
      variant: "info",
      title: "Add a photo",
      message: label,
      buttons: [
        { text: "Gallery", onPress: () => pick("gallery") },
        { text: "Camera", onPress: () => pick("camera") },
      ],
    });

  return (
    <View className="mb-4">
      <Text className="text-text-primary font-semibold text-sm">
        {label}
        {required ? <Text className="text-error"> *</Text> : null}
      </Text>
      {hint ? <Text className="text-text-muted text-xs mt-0.5">{hint}</Text> : null}
      <View className="flex-row flex-wrap gap-2 mt-2">
        {urls.map((url, index) => (
          <View key={url} className="relative">
            <RemoteImage source={{ uri: url }} style={{ width: 72, height: 72, borderRadius: 12 }} resizeMode="cover" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${index + 1}`}
              onPress={() => onChange(urls.filter((u) => u !== url))}
              className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-error items-center justify-center"
            >
              <Ionicons name="close" size={14} color={colors.white} />
            </Pressable>
          </View>
        ))}
        {urls.length < max && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add a photo: ${label}`}
            disabled={uploading}
            onPress={choose}
            className="w-[72px] h-[72px] rounded-xl border-2 border-dashed border-divider items-center justify-center"
          >
            {uploading ? (
              <ActivityIndicator size="small" />
            ) : (
              <Ionicons name="camera-outline" size={24} color={colors.text.muted} />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}
