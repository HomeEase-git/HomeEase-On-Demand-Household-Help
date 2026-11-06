import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { RemoteImage } from "./RemoteImage";
import { ImageLightbox } from "./ImageLightbox";
import { colors } from "../../constants";

type Props = {
  label: string;
  onPress: () => void;
  /** The current image. Tapping it opens it full size. */
  imageUri?: string | null;
  preview?: string | null;
  subtitle?: string;
  /** Prompt on the empty card. */
  hint?: string;
  statusLabel?: string;
  required?: boolean;
  disabled?: boolean;
  uploading?: boolean;
};

export const UploadCard: React.FC<Props> = ({
  label,
  onPress,
  imageUri,
  preview,
  subtitle,
  hint = "Tap to add a photo",
  statusLabel = "Uploaded",
  required,
  disabled,
  uploading,
}) => {
  const [viewing, setViewing] = useState(false);

  if (!imageUri && !preview && !uploading) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${hint}`}
        className={`bg-card-light border-2 border-dashed border-neutral-400 rounded-xl p-4 min-h-[120] ${disabled ? "opacity-60" : ""}`}
        onPress={onPress}
        disabled={disabled}
      >
        <View className="flex-row items-center mb-1">
          <Text className="text-brand text-sm font-semibold flex-1">{label}</Text>
          <View className={`ml-2 rounded-full px-2 py-1 ${required ? "bg-error/10" : "bg-accent/10"}`}>
            <Text className={`text-xs font-semibold ${required ? "text-error" : "text-accent"}`}>
              {required ? "Required" : "Optional"}
            </Text>
          </View>
        </View>
        {subtitle ? <Text className="text-text-secondary text-xs mt-1">{subtitle}</Text> : null}
        <View className="items-center mt-3">
          <Ionicons name="camera-outline" size={26} color={colors.text.secondary} />
          <Text className="text-text-secondary text-sm mt-1">{hint}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View className="bg-card border border-divider rounded-xl p-3">
      <Text className="text-brand text-sm font-semibold px-1 mb-2">{label}</Text>

      {imageUri ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${label} full size`}
          onPress={() => setViewing(true)}
          disabled={uploading}
          className="h-[182px] rounded-[10px] overflow-hidden bg-card-dark"
        >
          <RemoteImage
            source={{ uri: imageUri }}
            style={{ width: "100%", height: "100%", opacity: uploading ? 0.35 : 1 }}
            resizeMode="contain"
          />
          {uploading ? (
            <View className="absolute inset-0 items-center justify-center">
              <ActivityIndicator size="large" color={colors.brand.dark} />
              <Text className="text-neutral-800 text-sm font-semibold mt-2">Uploading…</Text>
            </View>
          ) : (
            <>
              <View className="absolute left-2 bottom-2 flex-row items-center bg-black/80 rounded-full px-2 py-1">
                <Ionicons name="checkmark" size={14} color={colors.success} />
                <Text className="text-white text-xs font-semibold ml-1">{statusLabel}</Text>
              </View>
              <View className="absolute right-2 top-2 w-8 h-8 rounded-full bg-black/80 items-center justify-center">
                <Ionicons name="expand-outline" size={16} color={colors.white} />
              </View>
            </>
          )}
        </Pressable>
      ) : (
        <View className="flex-row items-center bg-white border border-divider rounded-[10px] p-3">
          <View className="w-11 h-12 rounded-md bg-brand/10 items-center justify-center">
            {uploading ? (
              <ActivityIndicator size="small" color={colors.brand.dark} />
            ) : (
              <Ionicons name="document-text-outline" size={22} color={colors.brand.dark} />
            )}
          </View>
          <View className="flex-1 ml-3">
            {preview ? (
              <Text className="text-neutral-800 text-sm font-medium" numberOfLines={2}>
                {preview}
              </Text>
            ) : null}
            <Text className="text-text-secondary text-xs font-semibold mt-1">
              {uploading ? "Uploading…" : statusLabel}
            </Text>
          </View>
        </View>
      )}

      <View className="flex-row items-center justify-between pl-1">
        <Text className="text-text-secondary text-xs flex-1">
          {imageUri ? "Tap the photo to check it is clear." : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Replace ${label}`}
          onPress={onPress}
          disabled={disabled || uploading}
          className={`min-h-[44px] flex-row items-center px-3 ${disabled || uploading ? "opacity-60" : ""}`}
        >
          <Ionicons name="sync-outline" size={16} color={colors.brand.dark} />
          <Text className="text-brand-dark text-sm font-semibold ml-1.5">Replace</Text>
        </Pressable>
      </View>

      <ImageLightbox uri={viewing ? (imageUri ?? null) : null} title={label} onClose={() => setViewing(false)} />
    </View>
  );
};

export default UploadCard;
