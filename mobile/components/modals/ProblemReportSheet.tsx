import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import ModalWrapper from "./ModalWrapper";
import InputField from "../ui/InputField";
import PrimaryButton from "../ui/PrimaryButton";
import OutlinedButton from "../ui/OutlinedButton";
import type { ProblemReason } from "../../services/api";

type Props = {
  visible: boolean;
  workerArrived: boolean;
  inProgress: boolean;
  loading?: boolean;
  onSend: (reason: ProblemReason, note?: string) => void;
  onCancel: () => void;
};

const OTHER_MIN = 10;

// One tap to pick what went wrong, one to send. The server decides what
// happens next (ping, cancel, ask the worker, or report to HomeEase).
export const ProblemReportSheet: React.FC<Props> = ({
  visible,
  workerArrived,
  inProgress,
  loading,
  onSend,
  onCancel,
}) => {
  const [reason, setReason] = useState<ProblemReason | null>(null);
  const [note, setNote] = useState("");

  const chips: { value: ProblemReason; label: string }[] = [
    ...(workerArrived ? [] : [{ value: "WORKER_NOT_HERE" as const, label: "Worker isn't here" }]),
    ...(inProgress ? [{ value: "WORKER_STOPPED" as const, label: "Worker stopped working" }] : []),
    { value: "NEED_TO_CANCEL", label: "I need to cancel" },
    { value: "OTHER", label: "Other" },
  ];

  const trimmed = note.trim();
  const canSend = !!reason && (reason !== "OTHER" || trimmed.length >= OTHER_MIN);

  return (
    <ModalWrapper visible={visible} onClose={onCancel} title="Report a problem">
      <Text className="text-text-secondary text-sm mb-3">What went wrong?</Text>
      <View className="gap-2">
        {chips.map((chip) => {
          const selected = reason === chip.value;
          return (
            <Pressable
              key={chip.value}
              onPress={() => setReason(chip.value)}
              className={`border rounded-xl px-4 py-3 ${selected ? "border-brand bg-brand/10" : "border-border"}`}
            >
              <Text className={`text-sm ${selected ? "text-brand font-bold" : "text-text-primary"}`}>{chip.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {reason === "OTHER" && (
        <View className="mt-3">
          <InputField
            label="Details"
            value={note}
            onChangeText={setNote}
            placeholder="What happened?"
            multiline
          />
        </View>
      )}
      <View className="flex-row gap-3 mt-6">
        <View className="flex-1">
          <OutlinedButton label="Back" onPress={onCancel} />
        </View>
        <View className="flex-1">
          <PrimaryButton
            label="Send"
            disabled={!canSend || loading}
            loading={loading}
            onPress={() => canSend && onSend(reason!, reason === "OTHER" ? trimmed : undefined)}
          />
        </View>
      </View>
    </ModalWrapper>
  );
};

export default ProblemReportSheet;
