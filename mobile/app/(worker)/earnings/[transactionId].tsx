import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { Skeleton } from "../../../components/ui/Skeleton";
import * as api from "../../../services/api";

type TransactionDetail = Awaited<ReturnType<typeof api.getTransactionDetail>>;

export default function EarningsTransactionScreen() {
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
        if (active) setTransaction(result);
      } catch (error) {
        console.error("Load earnings transaction error:", error);
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
        <ScreenHeader title="Transaction Details" showBack />
        <View className="px-4 py-6">
          <View className="bg-card rounded-2xl p-6 mb-4 items-center">
            <Skeleton width="50%" height={32} marginBottom={0} />
          </View>
          <View className="bg-card rounded-2xl p-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <View
                key={i}
                className="flex-row justify-between py-2 border-b border-divider last:border-0"
              >
                <Skeleton width="30%" height={12} marginBottom={0} />
                <Skeleton width="40%" height={12} marginBottom={0} />
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!transaction) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Transaction Details" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Transaction Details" showBack />
      <View className="px-4 py-6">
        <View className="bg-success/20 rounded-2xl p-6 mb-4 items-center">
          <Text className="text-success font-bold text-4xl">
            +₱{transaction.amount?.toFixed(2)}
          </Text>
        </View>
        <View className="bg-card rounded-2xl p-4">
          <Row label="Reference" value={transaction.transactionId ?? transaction.id} />
          <Row label="Booking" value={transaction.bookingId} />
          <Row label="Service" value={transaction.serviceName} />
          <Row label="Client" value={transaction.clientName ?? "—"} />
          <Row label="Date" value={transaction.date} />
          <Row label="Method" value={transaction.method ?? "—"} />
          <Row label="Status" value={transaction.status} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2 border-b border-divider last:border-0">
      <Text className="text-text-secondary text-sm">{label}</Text>
      <Text className="text-primary font-semibold flex-1 text-right ml-4">{value}</Text>
    </View>
  );
}
