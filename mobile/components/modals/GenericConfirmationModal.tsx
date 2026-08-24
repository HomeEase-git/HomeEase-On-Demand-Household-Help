import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ModalWrapper from "./ModalWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import { colors } from "../../constants";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const GenericConfirmationModal: React.FC<Props> = ({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}) => {
  return (
    <ModalWrapper visible={visible} onClose={onCancel}>
      <View className="items-center mb-4">
        <View className="w-16 h-16 rounded-full bg-warning/10 items-center justify-center">
          <Ionicons name="warning-outline" size={36} color={colors.warning} />
        </View>
      </View>
      <Text className="text-text-primary font-bold text-lg text-center">
        {title}
      </Text>
      <Text className="text-text-secondary text-center mt-2">{message}</Text>
      <View className="flex-row gap-3 mt-6">
        <View className="flex-1">
          <OutlinedButton label={cancelLabel} onPress={onCancel} />
        </View>
        <View className="flex-1">
          <PrimaryButton label={confirmLabel} onPress={onConfirm} />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default GenericConfirmationModal;
