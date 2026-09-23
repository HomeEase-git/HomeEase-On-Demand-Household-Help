import React, { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import DangerButton from "../../../../components/ui/DangerButton";
import GenericConfirmationModal from "../../../../components/modals/GenericConfirmationModal";
import { useWorkerStore } from "../../../../store/workerStore";
import { cancelBooking } from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

// category feeds the backend's required workerCancellationReason — only
// WORKER_FAULT dents the worker's auto-match score (see
// matchingService/cancelBooking). Letting a worker honestly pick "the
// client wasn't there" instead of it always counting against them the same
// as a genuine no-show on their part is the whole point of this field.
const REASONS: Array<{ label: string; category: "WORKER_FAULT" | "CLIENT_NO_SHOW" | "OTHER" }> = [
  { label: "Can no longer make the schedule", category: "WORKER_FAULT" },
  { label: "Outside my service area", category: "WORKER_FAULT" },
  { label: "Client wasn't home / unreachable", category: "CLIENT_NO_SHOW" },
  { label: "Job scope is different than described", category: "OTHER" },
  { label: "Emergency came up", category: "OTHER" },
  { label: "Other", category: "OTHER" },
];

export default function WorkerCancelJobScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const updateJobStatus = useWorkerStore((s) => s.updateJobStatus);
  const [reason, setReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const canConfirm = !!reason && (reason !== "Other" || otherText.trim().length > 0);

  const handleConfirmCancel = async () => {
    setConfirmVisible(false);
    if (!jobId) return;

    const finalReason = reason === "Other" ? otherText.trim() : reason ?? "";
    const category = REASONS.find((r) => r.label === reason)?.category ?? "OTHER";

    setLoading(true);
    try {
      await cancelBooking(jobId, finalReason, category);
      updateJobStatus(jobId, "Cancelled");
      alertModal.success(
        "Job Cancelled",
        "This job has been cancelled and the client was notified.",
        [{ text: "OK", onPress: () => router.replace("/(worker)/requests") }],
      );
    } catch (error) {
      console.error("Worker cancel booking error:", error);
      alertModal.error("Error", "Failed to cancel this job. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Cancel Job" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <View className="bg-error/10 border border-error rounded-xl p-4 flex-row items-start mb-4">
          <Ionicons name="warning-outline" size={24} color={colors.error} />
          <Text className="text-error ml-2 flex-1 text-sm">
            Cancelling less than 24 hours before the job, for a reason on your
            end, lowers your ranking in auto-match.
          </Text>
        </View>

        <Text className="text-text-secondary text-sm font-semibold mb-2">
          Reason for cancelling
        </Text>
        {REASONS.map((r) => (
          <Pressable
            key={r.label}
            className={`bg-card rounded-xl p-3 mb-2 flex-row items-center ${
              reason === r.label ? "border-2 border-accent" : "border-2 border-transparent"
            }`}
            onPress={() => setReason(r.label)}
          >
            <View
              className={`w-5 h-5 rounded-full border-2 border-accent items-center justify-center mr-3 ${
                reason === r.label ? "bg-accent" : ""
              }`}
            >
              {reason === r.label && <View className="w-2 h-2 rounded-full bg-white" />}
            </View>
            <Text className="text-text-primary">{r.label}</Text>
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

        <View className="flex-row gap-3 mt-8">
          <OutlinedButton label="Keep Job" onPress={() => router.back()} />
          <View className="flex-1">
            <DangerButton
              label={loading ? "Cancelling..." : "Cancel Job"}
              fullWidth
              disabled={!canConfirm || loading}
              onPress={() => setConfirmVisible(true)}
            />
          </View>
        </View>
      </ScrollView>

      <GenericConfirmationModal
        visible={confirmVisible}
        title="Cancel this job?"
        message="This action cannot be undone."
        confirmLabel="Confirm"
        cancelLabel="Keep"
        onConfirm={handleConfirmCancel}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}
