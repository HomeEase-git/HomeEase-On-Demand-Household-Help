import React, { useEffect, useState } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import * as api from "../../../../services/api";

type TransactionListItem = {
  id: string;
  amount: number;
  date: string;
};

export default function PayoutMethodScreen() {
  const router = useRouter();
  const [history, setHistory] = useState<TransactionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api.getTransactions();
        if (!active) return;
        setHistory(result.data.filter((t: any) => t.status === "Completed"));
      } catch (error) {
        console.error("Load payout history error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Payout Method" showBack />
      <View className="px-4 py-6">
        <View className="bg-card rounded-2xl p-4 flex-row items-center mb-4">
          <View className="w-12 h-12 bg-green-500 rounded-full items-center justify-center mr-3">
            <Text className="text-text-primary font-bold text-lg">G</Text>
          </View>
          <View className="flex-1">
            <Text className="text-text-primary font-bold">GCash</Text>
            <Text className="text-text-secondary text-sm">09XX-XXX-XXXX</Text>
          </View>
          <Text
            className="text-accent font-semibold"
            onPress={() => router.push("/(worker)/earnings/payout/edit")}
          >
            Edit
          </Text>
        </View>
        <Text className="text-text-primary font-bold mb-2">Payout History</Text>
        {loading ? (
          <ActivityIndicator size="small" />
        ) : history.length === 0 ? (
          <Text className="text-text-secondary text-sm">No payouts yet</Text>
        ) : (
          <FlatList
            data={history}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View className="bg-card rounded-xl p-3 mb-2">
                <Text className="text-brand">
                  ₱{item.amount} ·{" "}
                  {new Date(item.date).toLocaleDateString("en-PH", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </Text>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
