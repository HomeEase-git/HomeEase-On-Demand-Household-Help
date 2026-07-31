import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import TransactionItem from "../../../components/list-items/TransactionItem";
import * as api from "../../../services/api";
import { colors } from "../../../constants";

type TransactionListItem = {
  id: string;
  bookingId: string;
  amount: number;
  method: string;
  status: string;
  date: string;
};

export default function EarningsScreen() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getTransactions();
      setTransactions(result.data);
    } catch (error) {
      console.error("Load earnings error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const completed = transactions.filter((t) => t.status === "Completed");
  const pending = transactions.filter((t) => t.status === "Pending");
  const totalEarnings = completed.reduce((sum, t) => sum + t.amount, 0);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 pt-4 pb-2 flex-row justify-between items-center">
        <Text className="text-text-primary text-2xl font-bold">History</Text>
        <Pressable onPress={() => router.push("/(worker)/earnings/breakdown")}>
          <Text className="text-accent font-semibold">See All</Text>
        </Pressable>
      </View>
      {loading ? (
        <View className="py-6 items-center">
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          <View className="bg-card rounded-2xl p-5 mx-4 mt-4">
            <View className="flex-row items-center mb-2">
              <Ionicons name="wallet" size={20} color={colors.warning} />
              <Text className="text-text-secondary text-sm ml-2">
                Total Earnings
              </Text>
            </View>
            <View className="flex-row items-center">
              <Ionicons
                name="arrow-undo-outline"
                size={20}
                color={colors.text.muted}
              />
              <Text className="text-text-primary font-bold text-3xl ml-2">
                ₱{totalEarnings.toFixed(2)}
              </Text>
            </View>
            <Text className="text-text-muted text-xs mt-1">
              After 10% platform fee
            </Text>
            <View className="flex-row gap-2 mt-3">
              <View className="flex-1 bg-card-dark rounded-xl p-3">
                <Text className="text-text-secondary text-xs">
                  Completed Jobs
                </Text>
                <Text className="text-brand font-semibold">
                  {completed.length}
                </Text>
              </View>
              <View className="flex-1 bg-card-dark rounded-xl p-3">
                <Text className="text-text-secondary text-xs">Pending Jobs</Text>
                <Text className="text-brand font-semibold">
                  {pending.length}
                </Text>
              </View>
            </View>
          </View>

          <View className="px-4 mt-4">
            <Text className="text-text-primary font-bold mb-2">Recent</Text>
            {transactions.length === 0 ? (
              <Text className="text-text-secondary text-sm">No transactions yet</Text>
            ) : (
              transactions.slice(0, 3).map((t) => (
                <TransactionItem
                  key={t.id}
                  transaction={t}
                  onPress={() => router.push(`/(worker)/earnings/${t.bookingId}`)}
                />
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
