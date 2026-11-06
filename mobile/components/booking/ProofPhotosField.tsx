import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { RemoteImage } from "../ui/RemoteImage";
import { ImageLightbox } from "../ui/ImageLightbox";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { useMediaPicker } from "../../hooks/useMediaPicker";
import { colors } from "../../constants";

type Props = {
  label: string;
  hint?: string;
  urls: string[];
  onChange: (urls: string[]) => void;
  upload: (uri: string) => Promise<{ url: string }>;
  max?: number;
  required?: boolean;
};

export default function ProofPhotosField({ label, hint, urls, onChange, upload, max = 5, required }: Props) {
  const alertModal = useAlertModal();
  const { pickImage } = useMediaPicker();
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const latestUrls = useRef(urls);
  useEffect(() => {
    latestUrls.current = urls;
  }, [urls]);

  const send = async (uri: string) => {
    setPendingUri(uri);
    try {
      const { url } = await upload(uri);
      onChange([...latestUrls.current, url]);
    } catch (error) {
      console.error("Upload photo error:", error);
      alertModal.error("Upload failed", "We couldn't upload that photo. Please try again.");
    } finally {
      setPendingUri(null);
    }
  };

  const choose = () => pickImage(label, send);

  const count = urls.length + (pendingUri ? 1 : 0);

  return (
    <View className="mb-4">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-text-primary font-semibold text-sm flex-1">
          {label}
          {required ? <Text className="text-error"> *</Text> : null}
        </Text>
        <Text className="text-text-secondary text-xs font-semibold ml-2">
          {urls.length}/{max}
        </Text>
      </View>
      {hint ? <Text className="text-text-secondary text-xs mt-0.5">{hint}</Text> : null}
      <View className="flex-row flex-wrap gap-3 mt-3">
        {urls.map((url, index) => (
          <View key={url} className="relative">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View photo ${index + 1} full size`}
              onPress={() => setViewingIndex(index)}
            >
              <RemoteImage source={{ uri: url }} style={{ width: 72, height: 72, borderRadius: 12 }} resizeMode="cover" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${index + 1}`}
              hitSlop={10}
              onPress={() => onChange(urls.filter((u) => u !== url))}
              className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-black/80 border border-white items-center justify-center"
            >
              <Ionicons name="close" size={14} color={colors.white} />
            </Pressable>
          </View>
        ))}
        {pendingUri && (
          <View accessibilityLabel="Uploading photo" className="w-[72px] h-[72px] rounded-xl overflow-hidden bg-card-dark items-center justify-center">
            <RemoteImage
              source={{ uri: pendingUri }}
              style={{ position: "absolute", width: 72, height: 72, opacity: 0.35 }}
              resizeMode="cover"
            />
            <ActivityIndicator size="small" color={colors.brand.dark} />
          </View>
        )}
        {count < max && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add a photo: ${label}`}
            disabled={!!pendingUri}
            onPress={choose}
            className={`w-[72px] h-[72px] rounded-xl border-2 border-dashed border-neutral-400 bg-card-light items-center justify-center ${pendingUri ? "opacity-60" : ""}`}
          >
            <Ionicons name="camera-outline" size={22} color={colors.text.secondary} />
            <Text className="text-text-secondary text-xs mt-0.5">Add photo</Text>
          </Pressable>
        )}
      </View>
      <ImageLightbox
        uri={viewingIndex === null ? null : (urls[viewingIndex] ?? null)}
        title={viewingIndex === null ? undefined : `Photo ${viewingIndex + 1} of ${urls.length}`}
        onClose={() => setViewingIndex(null)}
      />
    </View>
  );
}
