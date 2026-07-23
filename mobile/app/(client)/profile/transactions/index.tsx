import React, { useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import TransactionItem from "../../../../components/list-items/TransactionItem";
import EmptyState from "../../../../components/feedback/EmptyState";
import { useBookingStore } from "../../../../store/bookingStore";

const FILTERS = ["All", "This Week", "This Month"] as const;

export default function TransactionsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const bookings = useBookingStore((s) => s.bookings);

  // Derive transactions from completed bookings in the store
  const allTransactions = bookings
    .filter((b) => b.status === "Completed")
    .map((b) => ({
      id: `TXN-${b.id}`,
      bookingId: b.id,
      amount: b.amount,
      method: b.payment?.methodType ?? "Unknown",
      status: "Completed",
      date: b.date,
    }));

  const now = new Date();

  const filtered = allTransactions.filter((t) => {
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
    <SafeAreaView className="flex-1 bg-primary-white">
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
      {filtered.length === 0 ? (
        <EmptyState
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
                router.push(`/(client)/profile/transactions/${item.id}`)
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
