import React from "react";
import { View, Text, Pressable } from "react-native";
import * as ImagePicker from "expo-image-picker";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import { useAlertModal } from "../../contexts/AlertModalContext";

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
    } catch (error) {
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
    } catch (error) {
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
        className="bg-card-light rounded-xl py-4 px-4 mb-2"
        disabled={loading}
        onPress={openCamera}
      >
        <Text className="text-brand font-semibold">Take Photo</Text>
      </Pressable>
      <Pressable
        className="bg-card-light rounded-xl py-4 px-4"
        disabled={loading}
        onPress={openGallery}
      >
        <Text className="text-brand font-semibold">Choose from Gallery</Text>
      </Pressable>
      <Pressable
        className="py-4 mt-2"
        onPress={() => innerRef.current?.close()}
      >
        <Text className="text-brand text-center">Cancel</Text>
      </Pressable>
    </BottomSheetWrapper>
  );
};

export default ImageSourcePickerBottomSheet;
