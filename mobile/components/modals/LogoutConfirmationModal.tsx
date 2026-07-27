import React from "react";
import { View, Text } from "react-native";
import ModalWrapper from "./ModalWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";

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
      <Text className="text-text-primary font-bold text-lg text-center">
        Log out?
      </Text>
      <Text className="text-brand text-center mt-2">
        You will need to sign in again to access your account.
      </Text>
      <View className="flex-row gap-3 mt-6">
        <OutlinedButton label="Cancel" onPress={onCancel} />
        <View className="flex-1">
          <PrimaryButton label="Log Out" onPress={onConfirm} />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default LogoutConfirmationModal;
