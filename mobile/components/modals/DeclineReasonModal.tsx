import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import ModalWrapper from "./ModalWrapper";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";

const REASONS = [
  "Schedule conflict",
  "Too far from my service area",
  "Not equipped for this job",
  "Rate too low",
  "Other",
];

type Props = {
  visible: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

export const DeclineReasonModal: React.FC<Props> = ({
  visible,
  loading,
  onConfirm,
  onCancel,
}) => {
  const [reason, setReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");

  const canConfirm = !!reason && (reason !== "Other" || otherText.trim().length > 0);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(reason === "Other" ? otherText.trim() : reason!);
  };

  return (
    <ModalWrapper visible={visible} onClose={onCancel} title="Why are you declining?">
      {REASONS.map((r) => (
        <Pressable
          key={r}
          className={`bg-card-light rounded-xl p-3 mb-2 flex-row items-center ${
            reason === r ? "border-2 border-accent" : "border-2 border-transparent"
          }`}
          onPress={() => setReason(r)}
        >
          <View
            className={`w-5 h-5 rounded-full border-2 border-accent items-center justify-center mr-3 ${
              reason === r ? "bg-accent" : ""
            }`}
          >
            {reason === r && <View className="w-2 h-2 rounded-full bg-white" />}
          </View>
          <Text className="text-text-primary">{r}</Text>
        </Pressable>
      ))}

      {reason === "Other" && (
        <View className="mt-2">
          <InputField
            label="Please specify"
            value={otherText}
            onChangeText={setOtherText}
            placeholder="Tell the client why..."
            multiline
          />
        </View>
      )}

      <View className="flex-row gap-3 mt-6">
        <View className="flex-1">
          <OutlinedButton label="Never Mind" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <PrimaryButton
            label="Decline Job"
            disabled={!canConfirm || loading}
            loading={loading}
            onPress={handleConfirm}
          />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default DeclineReasonModal;
