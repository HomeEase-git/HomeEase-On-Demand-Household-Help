import React, { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../../../components/ui/Skeleton";
import * as api from "../../../../../services/api";

type TransactionDetail = Awaited<ReturnType<typeof api.getTransactionDetail>>;

export default function ReceiptScreen() {
  const router = useRouter();
  // The route segment is historically named `transactionId`, but the value
  // is a bookingId — GET /payments/:bookingId is how the backend looks up a payment.
  const { transactionId: bookingId } = useLocalSearchParams<{
    transactionId: string;
  }>();
  const [transaction, setTransaction] = useState<TransactionDetail>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!bookingId) return;
      setLoading(true);
      try {
        const result = await api.getTransactionDetail(bookingId);
        if (!active) return;
        setTransaction(result);
      } catch (error) {
        console.error("Load receipt error:", error);
        if (active) setTransaction(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [bookingId]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Receipt" showBack />
        <View className="px-4 py-4">
          <View className="mx-4 mt-4 rounded-2xl border border-divider overflow-hidden">
            <View className="bg-card p-6 items-center">
              <Skeleton width="40%" height={22} marginBottom={8} />
              <Skeleton width="30%" height={12} marginBottom={0} />
            </View>
            <View className="p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <View
                  key={i}
                  className="flex-row justify-between py-2 border-b border-divider last:border-0"
                >
                  <Skeleton width="30%" height={12} marginBottom={0} />
                  <Skeleton width="35%" height={12} marginBottom={0} />
                </View>
              ))}
            </View>
            <View className="p-6 flex-row justify-between items-center">
              <Skeleton width="30%" height={18} marginBottom={0} />
              <Skeleton width="25%" height={22} marginBottom={0} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!transaction) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Receipt" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Receipt not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const formattedDate = new Date(transaction.date).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Receipt" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Receipt Card */}
        <View className="bg-white mx-4 mt-4 rounded-2xl border border-divider overflow-hidden">
          {/* Header */}
          <View className="bg-accent p-6 items-center">
            <Text className="text-text-primary font-bold text-2xl">HomeEase</Text>
            <Text className="text-primary/80 text-sm mt-1">
              Official Receipt
            </Text>
          </View>

          {/* Dashed Divider */}
          <View className="border-b border-dashed border-divider mx-4" />

          {/* Body */}
          <View className="p-6">
            <Row label="Reference" value={transaction.transactionId ?? transaction.id} />
            <Row label="Booking ID" value={transaction.bookingId} />
            <Row label="Date" value={formattedDate} />
            <Row label="Payment Method" value={transaction.method ?? "—"} />
            <Row label="Status" value={transaction.status} />
          </View>

          {/* Divider */}
          <View className="border-b border-divider mx-4" />

          {/* Total */}
          <View className="p-6 flex-row justify-between items-center">
            <Text className="text-text-primary font-bold text-lg">Total Paid</Text>
            <Text className="text-accent font-bold text-2xl">
              ₱{transaction.amount?.toFixed(2)}
            </Text>
          </View>

          {/* Footer */}
          <View className="bg-card p-4 items-center">
            <Text className="text-text-secondary text-xs text-center">
              Thank you for using HomeEase!
            </Text>
            <Text className="text-accent text-xs text-center mt-1">
              support@homeease.com
            </Text>
          </View>
        </View>

        {/* Done Button */}
        <View className="px-4 mt-6">
          <PrimaryButton label="Done" fullWidth onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-divider last:border-0">
      <Text className="text-text-secondary text-sm">{label}</Text>
      <Text className="text-primary font-semibold">{value}</Text>
    </View>
  );
}
