import React, { useEffect, useState } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import TransactionItem from "../../../components/list-items/TransactionItem";
import EmptyState from "../../../components/feedback/EmptyState";
import * as api from "../../../services/api";

type TransactionListItem = {
  id: string;
  bookingId: string;
  amount: number;
  method: string;
  status: string;
  date: string;
};

export default function EarningsBreakdownScreen() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const result = await api.getTransactions();
        if (active) setTransactions(result.data);
      } catch (error) {
        console.error("Load earnings breakdown error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const total = transactions.reduce((sum, t) => sum + t.amount, 0);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Earnings Breakdown" showBack />
      <View className="px-4 py-4 flex-1">
        {loading ? (
          <View className="py-6 items-center">
            <ActivityIndicator size="small" />
          </View>
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
              <EmptyState title="No transactions yet" />
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
