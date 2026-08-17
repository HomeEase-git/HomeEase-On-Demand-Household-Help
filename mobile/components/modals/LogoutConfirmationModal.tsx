import React from "react";
import { View, Text } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import ModalWrapper from "./ModalWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import { colors } from "../../constants";

type Props = {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const LogoutConfirmationModal: React.FC<Props> = ({
  visible,
  onConfirm,
  onCancel,
}) => {
  return (
    <ModalWrapper visible={visible} onClose={onCancel}>
      <View className="items-center mb-4">
        <View className="w-16 h-16 rounded-full bg-error/10 items-center justify-center">
          <Ionicons name="log-out-outline" size={36} color={colors.error} />
        </View>
      </View>
      <Text className="text-text-primary font-bold text-lg text-center">
        Log out?
      </Text>
      <Text className="text-text-secondary text-center mt-2">
        You will need to sign in again to access your account.
      </Text>
      <View className="flex-row gap-3 mt-6">
        <View className="flex-1">
          <OutlinedButton label="Cancel" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <PrimaryButton label="Log Out" onPress={onConfirm} />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default LogoutConfirmationModal;
