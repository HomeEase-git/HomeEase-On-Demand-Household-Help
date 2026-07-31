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
import { useBookingStore } from "../../../../store/bookingStore";
import { cancelBooking } from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const REASONS = [
  "Changed my mind",
  "Worker taking too long",
  "Found another service",
  "Emergency",
  "Other",
];

export default function CancelBookingScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, updateBookingStatus } = useBookingStore();
  const [reason, setReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const booking = bookings.find((b) => b.id === bookingId);

  const canConfirm =
    !!reason && (reason !== "Other" || otherText.trim().length > 0);

  const handleConfirmCancel = async () => {
    setConfirmVisible(false);
    if (!bookingId) return;

    const finalReason = reason === "Other" ? otherText.trim() : reason ?? "";

    setLoading(true);
    try {
      await cancelBooking(bookingId, finalReason);
      updateBookingStatus(bookingId, "Cancelled");
      alertModal.success(
        "Booking Cancelled",
        "Your booking has been cancelled successfully.",
        [{ text: "OK", onPress: () => router.replace("/(client)/booking") }],
      );
    } catch (error) {
      console.error("Cancel booking error:", error);
      alertModal.error("Error", "Failed to cancel booking. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Cancel Booking" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        <View className="bg-error/10 border border-error rounded-xl p-4 flex-row items-start mb-4">
          <Ionicons name="warning-outline" size={24} color={colors.error} />
          <Text className="text-error ml-2 flex-1 text-sm">
            Cancellations may not be refundable depending on timing and payment
            method.
          </Text>
        </View>

        {booking && (
          <View className="bg-card rounded-2xl p-4 mb-4">
            <Text className="text-text-primary font-bold">{booking.service}</Text>
            <Text className="text-text-secondary text-sm mt-1">
              {booking.worker} · {booking.date} · ₱{booking.amount}
            </Text>
          </View>
        )}

        <Text className="text-text-secondary text-sm font-semibold mb-2">
          Reason for cancellation
        </Text>
        {REASONS.map((r) => (
          <Pressable
            key={r}
            className={`bg-card rounded-xl p-3 mb-2 flex-row items-center ${
              reason === r
                ? "border-2 border-accent"
                : "border-2 border-transparent"
            }`}
            onPress={() => setReason(r)}
          >
            <View
              className={`w-5 h-5 rounded-full border-2 border-accent items-center justify-center mr-3 ${
                reason === r ? "bg-accent" : ""
              }`}
            >
              {reason === r && (
                <View className="w-2 h-2 rounded-full bg-white" />
              )}
            </View>
            <Text className="text-primary">{r}</Text>
          </Pressable>
        ))}

        {reason === "Other" && (
          <View className="mt-2">
            <InputField
              label="Please specify"
              value={otherText}
              onChangeText={setOtherText}
              placeholder="Tell us why you're cancelling..."
              multiline
            />
          </View>
        )}

        <View className="flex-row gap-3 mt-8">
          <OutlinedButton label="Keep Booking" onPress={() => router.back()} />
          <View className="flex-1">
            <DangerButton
              label={loading ? "Cancelling..." : "Cancel Booking"}
              fullWidth
              disabled={!canConfirm || loading}
              onPress={() => setConfirmVisible(true)}
            />
          </View>
        </View>
      </ScrollView>

      <GenericConfirmationModal
        visible={confirmVisible}
        title="Cancel this booking?"
        message="This action cannot be undone. Your booking will be permanently cancelled."
        confirmLabel="Yes, Cancel"
        cancelLabel="Keep Booking"
        onConfirm={handleConfirmCancel}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}
