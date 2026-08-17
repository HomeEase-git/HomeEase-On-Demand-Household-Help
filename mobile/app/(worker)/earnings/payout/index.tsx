import React, { useEffect, useState } from "react";
import { View, Text, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import { Skeleton } from "../../../../components/ui/Skeleton";
import * as api from "../../../../services/api";
import { cardShadow } from "../../../../constants";

type TransactionListItem = {
  id: string;
  amount: number;
  date: string;
  payoutStatus: string | null;
  payoutFailureReason: string | null;
};

const METHOD_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  GCASH: { label: "GCash", icon: "G", color: "bg-green-500" },
  MAYA: { label: "Maya", icon: "M", color: "bg-teal-500" },
  BANK_TRANSFER: { label: "Bank Transfer", icon: "B", color: "bg-blue-500" },
};

// Real PayMongo transfer status per job — there's no batched "balance", each
// completed job's payout is queued and sent individually (see
// paymentLifecycleService.schedulePayout), so this is the honest signal for
// "have I actually been paid" rather than an invented balance/next-date figure.
const PAYOUT_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Payout queued", className: "text-warning" },
  PROCESSING: { label: "Payout processing", className: "text-accent" },
  PAID: { label: "Paid out", className: "text-success" },
  FAILED: { label: "Payout failed", className: "text-error" },
};

export default function PayoutMethodScreen() {
  const router = useRouter();
  const [history, setHistory] = useState<TransactionListItem[]>([]);
  const [payout, setPayout] = useState<api.PayoutMethod | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [result, payoutMethod] = await Promise.all([
          api.getTransactions(),
          api.getPayoutMethod(),
        ]);
        if (!active) return;
        setHistory(result.data.filter((t: any) => t.status === "Completed"));
        setPayout(payoutMethod);
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

  const methodInfo = payout?.payoutMethod ? METHOD_LABELS[payout.payoutMethod] : null;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Payout Method" showBack />
      <View className="px-4 py-6">
        <View className="bg-card rounded-2xl p-4 flex-row items-center mb-4" style={cardShadow}>
          <View className={`w-12 h-12 ${methodInfo?.color ?? "bg-card-light"} rounded-full items-center justify-center mr-3`}>
            <Text className="text-text-primary font-bold text-lg">{methodInfo?.icon ?? "?"}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-text-primary font-bold">{methodInfo?.label ?? "Not set"}</Text>
            <Text className="text-text-secondary text-sm">
              {payout?.payoutAccountNumber ?? "Add a payout method to get paid"}
            </Text>
          </View>
          <Text
            className="text-accent font-semibold"
            onPress={() => router.push("/(worker)/earnings/payout/edit")}
          >
            {methodInfo ? "Edit" : "Set up"}
          </Text>
        </View>
        <Text className="text-text-primary font-bold mb-2">Payout History</Text>
        {loading ? (
          <View>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} className="bg-card rounded-2xl p-3 mb-2">
                <Skeleton width="60%" height={14} marginBottom={0} />
              </View>
            ))}
          </View>
        ) : history.length === 0 ? (
          <Text className="text-text-secondary text-sm">No payouts yet</Text>
        ) : (
          <FlatList
            data={history}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const payoutStatus = item.payoutStatus ? PAYOUT_STATUS_LABELS[item.payoutStatus] : null;
              return (
                <View className="bg-card rounded-2xl p-3 mb-2" style={cardShadow}>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-text-primary">
                      ₱{item.amount} ·{" "}
                      {new Date(item.date).toLocaleDateString("en-PH", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </Text>
                    {payoutStatus && (
                      <Text className={`text-xs font-semibold ${payoutStatus.className}`}>
                        {payoutStatus.label}
                      </Text>
                    )}
                  </View>
                  {item.payoutStatus === "FAILED" && item.payoutFailureReason && (
                    <Text className="text-error text-xs mt-1">{item.payoutFailureReason}</Text>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
