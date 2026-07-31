import React from "react";
import { View, Text, Pressable, Image, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import { colors } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function ImageViewerScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { imageUrl } = useLocalSearchParams<{ imageUrl?: string }>();

  const handleOpenExternally = () => {
    if (!imageUrl) return;
    Linking.openURL(imageUrl).catch(() =>
      alertModal.error("Error", "Could not open this image."),
    );
  };

  return (
    <View className="flex-1 bg-black">
      <SafeAreaView className="absolute top-0 left-0 right-0 z-10 flex-row justify-between px-4 py-2">
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.white} />
        </Pressable>
        {imageUrl && (
          <Pressable onPress={handleOpenExternally}>
            <Ionicons name="open-outline" size={24} color={colors.white} />
          </Pressable>
        )}
      </SafeAreaView>
      <View className="flex-1 items-center justify-center">
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            className="w-full h-full"
            resizeMode="contain"
          />
        ) : (
          <>
            <Ionicons name="image" size={80} color={colors.text.muted} />
            <Text className="text-text-secondary mt-2">No image to display</Text>
          </>
        )}
      </View>
    </View>
  );
}
