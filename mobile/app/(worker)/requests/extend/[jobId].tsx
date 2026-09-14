import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import GenericConfirmationModal from "../../../../components/modals/GenericConfirmationModal";
import { extendBooking } from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

/**
 * Confirmation for "Continue Tomorrow" (see the IN_PROGRESS action block on
 * the job detail screen) — this has real consequences for OTHER clients
 * (any booking of this worker's colliding with tomorrow gets moved or
 * escalated, see backend extendBooking), so it gets its own screen rather
 * than a single-tap confirm like Arrive/Start.
 */
export default function ExtendJobScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleConfirmExtend = async () => {
    setConfirmVisible(false);
    if (!jobId) return;

    setLoading(true);
    try {
      const result = await extendBooking(jobId);
      const summary =
        result.escalated > 0
          ? `Tomorrow is reserved. ${result.resolved} booking(s) were moved automatically; ${result.escalated} couldn't be and were sent to support.`
          : result.resolved > 0
            ? `Tomorrow is reserved. ${result.resolved} booking(s) were moved to make room.`
            : "Tomorrow is reserved for this job.";
      alertModal.success("Job Extended", summary, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Extend booking error:", error);
      alertModal.error("Error", "Failed to extend this job. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Continue Tomorrow" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <View className="bg-warning/10 border border-warning rounded-xl p-4 flex-row items-start mb-4">
          <Ionicons name="warning-outline" size={24} color={colors.warning} />
          <Text className="text-text-primary ml-2 flex-1 text-sm">
            This reserves tomorrow on your calendar for this job. If you have another booking at the same time
            tomorrow, we&apos;ll automatically move it to your next open day and notify that client — or, if no open
            day is found within 14 days, send it to support to sort out.
          </Text>
        </View>

        <Text className="text-text-secondary text-sm">
          Only do this if you genuinely need another day to finish this job.
        </Text>

        <View className="flex-row gap-3 mt-8">
          <OutlinedButton label="Not Yet" onPress={() => router.back()} />
          <View className="flex-1">
            <PrimaryButton
              label={loading ? "Extending..." : "Continue Tomorrow"}
              fullWidth
              disabled={loading}
              onPress={() => setConfirmVisible(true)}
            />
          </View>
        </View>
      </ScrollView>

      <GenericConfirmationModal
        visible={confirmVisible}
        title="Reserve tomorrow for this job?"
        message="Any of your other bookings tomorrow at the same time will be moved automatically."
        confirmLabel="Yes, Continue Tomorrow"
        cancelLabel="Not Yet"
        onConfirm={handleConfirmExtend}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}
