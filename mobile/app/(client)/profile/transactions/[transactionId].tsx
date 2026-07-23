import React from "react";
import { View, Text, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import { useBookingStore } from "../../../../store/bookingStore";

export default function TransactionDetailScreen() {
  const router = useRouter();
  const { transactionId } = useLocalSearchParams<{
    transactionId: string;
  }>();
  const bookings = useBookingStore((s) => s.bookings);

  // Transaction IDs are derived as TXN-{bookingId} from the list screen
  // Strip the TXN- prefix to find the booking
  const bookingId = transactionId?.replace("TXN-", "");
  const booking = bookings.find(
    (b) => b.id === bookingId && b.status === "Completed",
  );

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-primary-white">
        <ScreenHeader title="Transaction Details" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Transaction not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const transaction = {
    id: `TXN-${booking.id}`,
    bookingId: booking.id,
    amount: booking.amount,
    method: booking.payment?.methodType ?? "Unknown",
    status: "Completed",
    date: new Date(booking.date).toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="Transaction Details" showBack />
      <View className="px-4 py-6">
        <View className="bg-success/20 rounded-2xl p-6 mb-4 items-center">
          <Text className="text-success font-bold text-4xl">
            ₱{transaction.amount}.00
          </Text>
          <Text className="text-text-secondary text-sm mt-2">
            {transaction.status}
          </Text>
          <View className="mt-2">
            <StatusBadge status="Completed" />
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mb-4">
          <Row label="Reference" value={transaction.id} />
          <Row label="Booking" value={transaction.bookingId} />
          <Row label="Service" value={booking.service} />
          <Row label="Worker" value={booking.worker} />
          <Row label="Date" value={transaction.date} />
          <Row label="Method" value={transaction.method} />
        </View>

        <View className="gap-3">
          <OutlinedButton
            label="Download Receipt"
            onPress={() =>
              Alert.alert("Receipt", "Receipt saved to Downloads.")
            }
          />
          <PrimaryButton
            label="View Receipt"
            fullWidth
            onPress={() =>
              router.push(
                `/(client)/profile/transactions/receipt/${transaction.bookingId}`,
              )
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-divider last:border-0">
      <Text className="text-text-secondary text-sm">{label}</Text>
      <Text className="text-primary font-semibold flex-1 text-right ml-4">
        {value}
      </Text>
    </View>
  );
}
