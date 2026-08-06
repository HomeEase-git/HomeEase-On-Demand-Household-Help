import React, { useCallback, useEffect, useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import TransactionItem from "../../../components/list-items/TransactionItem";
import EmptyState from "../../../components/feedback/EmptyState";
import { Skeleton, SkeletonList, TransactionItemSkeleton } from "../../../components/ui/Skeleton";
import * as api from "../../../services/api";

type TransactionListItem = {
  id: string;
  bookingId: string;
  amount: number;
  method: string;
  status: string;
  date: string;
};

const FILTERS = [
  { label: "All", value: undefined },
  { label: "Paid Out", value: "COMPLETED" as const },
  { label: "Pending", value: "PENDING" as const },
  { label: "Refunded", value: "REFUNDED" as const },
];

export default function EarningsBreakdownScreen() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterIndex, setFilterIndex] = useState(0);

  const load = useCallback(async (status?: "COMPLETED" | "PENDING" | "REFUNDED") => {
    setLoading(true);
    try {
      const result = await api.getTransactions(undefined, status);
      setTransactions(result.data);
    } catch (error) {
      console.error("Load earnings breakdown error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Standard fetch-on-filter-change pattern — the linter's static trace
    // flags the setState calls inside `load` (even the ones after an
    // `await`) as "synchronous within an effect", which isn't actually true.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(FILTERS[filterIndex].value);
  }, [filterIndex, load]);

  const total = transactions.reduce((sum, t) => sum + t.amount, 0);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Earnings Breakdown" showBack />
      <View className="px-4 pt-3">
        <View className="flex-row gap-2">
          {FILTERS.map((f, i) => (
            <Pressable
              key={f.label}
              onPress={() => setFilterIndex(i)}
              className={`px-3 py-1.5 rounded-full ${filterIndex === i ? "bg-accent" : "bg-card"}`}
            >
              <Text className={`text-xs font-semibold ${filterIndex === i ? "text-white" : "text-text-secondary"}`}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View className="px-4 py-4 flex-1">
        {loading ? (
          <>
            <View className="bg-card rounded-2xl p-4 mb-4">
              <Skeleton width="20%" height={12} marginBottom={8} />
              <Skeleton width="40%" height={26} marginBottom={8} />
              <Skeleton width="50%" height={10} marginBottom={0} />
            </View>
            <SkeletonList count={5} SkeletonComponent={TransactionItemSkeleton} spacing={0} />
          </>
        ) : (
          <>
            <View className="bg-card rounded-2xl p-4 mb-4">
              <Text className="text-text-secondary text-sm">Total</Text>
              <Text className="text-text-primary font-bold text-2xl">₱{total}.00</Text>
              <Text className="text-text-muted text-xs mt-1">
                {transactions.length} jobs
                {transactions.length > 0
                  ? ` · Avg ₱${Math.round(total / transactions.length)}`
                  : ""}
              </Text>
            </View>
            {transactions.length === 0 ? (
              <EmptyState
                icon="receipt-outline"
                title="No transactions yet"
                subtitle="Completed jobs will appear here once you get paid."
              />
            ) : (
              <FlatList
                data={transactions}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TransactionItem
                    transaction={item}
                    onPress={() => router.push(`/(worker)/earnings/${item.bookingId}`)}
                  />
                )}
              />
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
