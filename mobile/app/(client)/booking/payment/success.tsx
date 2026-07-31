import React from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { useBookingStore } from "../../../../store/bookingStore";
import { colors } from "../../../../constants";

export default function PaymentSuccessScreen() {
  const router = useRouter();
  const booking = useBookingStore((s) => s.selectedBooking);

  const amountLabel = booking ? `₱${booking.amount.toFixed(2)}` : null;
  const paymentLabel = booking?.payment?.methodType ?? "Payment pending";
  const referenceLabel = booking ? `${booking.id} · ${paymentLabel}` : null;

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <View className="w-32 h-32 bg-success/20 rounded-full items-center justify-center mb-8">
        <Ionicons name="checkmark-circle" size={80} color={colors.success} />
      </View>
      <Text className="text-success text-2xl font-bold text-center">
        Booking Request Submitted!
      </Text>
      {(amountLabel || referenceLabel) && (
        <View className="bg-card rounded-2xl p-4 w-full mt-6">
          {amountLabel && (
            <Text className="text-text-secondary text-sm">{amountLabel}</Text>
          )}
          {referenceLabel && (
            <Text className="text-brand font-semibold">{referenceLabel}</Text>
          )}
        </View>
      )}
      <View className="w-full mt-8 gap-3">
        <OutlinedButton
          label="View Booking"
          onPress={() => {
            if (booking) {
              router.push(`/(client)/booking/${booking.id}`);
            } else {
              router.push("/(client)/booking");
            }
          }}
        />
        <PrimaryButton
          label="Go to Home"
          fullWidth
          onPress={() => router.replace("/(client)/home")}
        />
      </View>
    </SafeAreaView>
  );
}
