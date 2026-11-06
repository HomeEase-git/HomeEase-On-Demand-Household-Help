import React from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { RemoteImage } from "./RemoteImage";
import { colors } from "../../constants";

type Props = {
  uri: string | null;
  title?: string;
  onClose: () => void;
};

export function ImageLightbox({ uri, title, onClose }: Props) {
  return (
    <Modal visible={!!uri} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView className="flex-1 bg-black">
        <View className="flex-row items-center px-2 py-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            onPress={onClose}
            className="w-11 h-11 items-center justify-center"
          >
            <Ionicons name="close" size={24} color={colors.white} />
          </Pressable>
          {title ? (
            <Text className="text-white font-semibold flex-1" numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </View>
        <RemoteImage source={{ uri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel={title ?? "Photo"} />
      </SafeAreaView>
    </Modal>
  );
}

export default ImageLightbox;
