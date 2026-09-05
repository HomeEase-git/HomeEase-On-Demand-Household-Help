import React from "react";
import { View, Text, Pressable } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import OutlinedButton from "../ui/OutlinedButton";
import { useAlertModal } from "../../contexts/AlertModalContext";
import { colors, cardShadow } from "../../constants";

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  onSelect: (uri: string) => void;
};

export const ImageSourcePickerBottomSheet: React.FC<Props> = ({
  innerRef,
  onSelect,
}) => {
  const [loading, setLoading] = React.useState(false);
  const alertModal = useAlertModal();

  const openCamera = async () => {
    if (loading) return;
    try {
      setLoading(true);
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        alertModal.warning(
          "Permission required",
          "Camera access is needed to take a photo.",
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
      });
      if (!result.canceled && result.assets[0]) {
        onSelect(result.assets[0].uri);
        innerRef.current?.close();
      }
    } catch {
      alertModal.error(
        "Error",
        "Something went wrong while opening the camera. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const openGallery = async () => {
    if (loading) return;
    try {
      setLoading(true);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
      });
      if (!result.canceled && result.assets[0]) {
        onSelect(result.assets[0].uri);
        innerRef.current?.close();
      }
    } catch {
      alertModal.error(
        "Error",
        "Something went wrong while opening your gallery. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheetWrapper
      innerRef={innerRef}
      snapPoints={["35%"]}
      title="Choose source"
    >
      <Pressable
        className="bg-white rounded-2xl py-4 px-4 mb-2 flex-row items-center"
        style={cardShadow}
        disabled={loading}
        onPress={openCamera}
      >
        <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
          <Ionicons name="camera-outline" size={18} color={colors.accent.DEFAULT} />
        </View>
        <Text className="text-text-primary font-semibold">Take Photo</Text>
      </Pressable>
      <Pressable
        className="bg-white rounded-2xl py-4 px-4 flex-row items-center"
        style={cardShadow}
        disabled={loading}
        onPress={openGallery}
      >
        <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
          <Ionicons name="image-outline" size={18} color={colors.accent.DEFAULT} />
        </View>
        <Text className="text-text-primary font-semibold">Choose from Gallery</Text>
      </Pressable>
      <View className="mt-2">
        <OutlinedButton
          label="Cancel"
          fullWidth
          onPress={() => innerRef.current?.close()}
        />
      </View>
    </BottomSheetWrapper>
  );
};

export default ImageSourcePickerBottomSheet;
