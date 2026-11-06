import React, { useState } from "react";
import { View, Text } from "react-native";
import ModalWrapper from "./ModalWrapper";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";

type Props = {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  placeholder?: string;
  minLength?: number;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export const ReportModal: React.FC<Props> = ({
  visible,
  title,
  message = "Tell us what breaks the rules (rude, false, or private information). An admin will review it.",
  confirmLabel = "Report",
  placeholder = "What is wrong with it?",
  minLength = 5,
  loading,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length >= minLength;

  return (
    <ModalWrapper visible={visible} onClose={onCancel} title={title}>
      <Text className="text-text-secondary text-sm mb-3">{message}</Text>
      <InputField
        label="Details"
        value={reason}
        onChangeText={setReason}
        placeholder={placeholder}
        multiline
      />
      <View className="flex-row gap-3 mt-6">
        <View className="flex-1">
          <OutlinedButton label="Back" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <PrimaryButton
            label={confirmLabel}
            disabled={!canConfirm || loading}
            loading={loading}
            onPress={() => canConfirm && onConfirm(reason.trim())}
          />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default ReportModal;
