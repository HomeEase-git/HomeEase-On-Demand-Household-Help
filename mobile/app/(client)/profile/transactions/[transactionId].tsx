import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import type { StatusType } from "../../../../components/ui/StatusBadge";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { cardShadow } from "../../../../constants";
import * as api from "../../../../services/api";

type TransactionDetail = Awaited<ReturnType<typeof api.getTransactionDetail>>;

export default function TransactionDetailScreen() {
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
        console.error("Load transaction detail error:", error);
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
          <View className="bg-card rounded-2xl p-6 mb-4 items-center" style={cardShadow}>
            <Skeleton width="50%" height={32} marginBottom={8} />
            <Skeleton width="30%" height={12} marginBottom={8} />
            <Skeleton width={90} height={22} borderRadius={11} marginBottom={0} />
          </View>
          <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View
                key={i}
                className="flex-row justify-between py-2 border-b border-divider last:border-0"
              >
                <Skeleton width="30%" height={12} marginBottom={0} />
                <Skeleton width="40%" height={12} marginBottom={0} />
              </View>
            ))}
          </View>
          <Skeleton width="100%" height={48} borderRadius={12} marginBottom={12} />
          <Skeleton width="100%" height={48} borderRadius={12} marginBottom={0} />
        </View>
      </SafeAreaView>
    );
  }

  if (!transaction) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Transaction Details" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Transaction not found</Text>
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
      <ScreenHeader title="Transaction Details" showBack />
      <View className="px-4 py-6">
        <View className="bg-success/20 rounded-2xl p-6 mb-4 items-center" style={cardShadow}>
          <Text className="text-success font-bold text-4xl">
            ₱{transaction.amount?.toFixed(2)}
          </Text>
          <Text className="text-text-secondary text-sm mt-2">
            {transaction.status}
          </Text>
          <View className="mt-2">
            <StatusBadge status={transaction.status as StatusType} />
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Row label="Reference" value={transaction.transactionId ?? transaction.id} />
          <Row label="Booking" value={transaction.bookingId} />
          <Row label="Service" value={transaction.serviceName} />
          <Row label="Worker" value={transaction.workerName ?? "—"} />
          <Row label="Date" value={formattedDate} />
          <Row label="Method" value={transaction.method ?? "—"} />
        </View>

        <View className="gap-3">
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
      <Text className="text-text-primary font-semibold flex-1 text-right ml-4">
        {value}
      </Text>
    </View>
  );
}
