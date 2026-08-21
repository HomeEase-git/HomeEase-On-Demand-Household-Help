import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ModalWrapper from "./ModalWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import { colors } from "../../constants";

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
};

export const GenericSuccessModal: React.FC<Props> = ({
  visible,
  title,
  onClose,
}) => {
  return (
    <ModalWrapper visible={visible} onClose={onClose}>
      <View className="items-center mb-4">
        <View className="w-16 h-16 rounded-full bg-success/10 items-center justify-center">
          <Ionicons name="checkmark-circle" size={36} color={colors.success} />
        </View>
      </View>
      <Text className="text-text-primary font-bold text-lg text-center">
        {title}
      </Text>
      <View className="mt-6">
        <PrimaryButton label="OK" fullWidth onPress={onClose} />
      </View>
    </ModalWrapper>
  );
};

export default GenericSuccessModal;
