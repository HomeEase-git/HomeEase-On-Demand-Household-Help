import React, { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import TransactionItem from "../../../../components/list-items/TransactionItem";
import EmptyState from "../../../../components/feedback/EmptyState";
import { SkeletonList, TransactionItemSkeleton } from "../../../../components/ui/Skeleton";
import * as api from "../../../../services/api";

const FILTERS = ["All", "This Week", "This Month"] as const;

type TransactionListItem = {
  id: string;
  bookingId: string;
  amount: number;
  method: string;
  status: string;
  date: string;
};

export default function TransactionsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setFailed(false);
      try {
        const result = await api.getTransactions();
        if (!active) return;
        setTransactions(result.data);
      } catch (error) {
        console.error("Load transactions error:", error);
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [attempt]);

  const now = new Date();

  const filtered = transactions.filter((t) => {
    if (filter === "All") return true;
    const txDate = new Date(t.date);
    if (filter === "This Week") {
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 7);
      return txDate >= weekAgo;
    }
    if (filter === "This Month") {
      return (
        txDate.getMonth() === now.getMonth() &&
        txDate.getFullYear() === now.getFullYear()
      );
    }
    return true;
  });

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Transaction History" showBack />
      <View className="flex-row gap-2 px-4 py-2">
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            className={`px-3 py-2 rounded-xl ${
              filter === f ? "bg-accent" : "bg-card"
            }`}
            onPress={() => setFilter(f)}
          >
            <Text
              className={
                filter === f
                  ? "text-white font-semibold text-sm"
                  : "text-text-secondary text-sm"
              }
            >
              {f}
            </Text>
          </Pressable>
        ))}
      </View>
      {loading ? (
        <View className="px-4 pt-2">
          <SkeletonList count={6} SkeletonComponent={TransactionItemSkeleton} spacing={0} />
        </View>
      ) : failed ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load your transactions"
          subtitle="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => setAttempt((n) => n + 1)}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No transactions yet"
          subtitle={
            filter === "All"
              ? "Completed bookings will appear here."
              : `No transactions found for ${filter.toLowerCase()}.`
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <TransactionItem
              transaction={item}
              onPress={() =>
                router.push(`/(client)/profile/transactions/${item.bookingId}`)
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
