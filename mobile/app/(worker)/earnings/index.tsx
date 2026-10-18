import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import TransactionItem from "../../../components/list-items/TransactionItem";
import * as api from "../../../services/api";
import { colors } from "../../../constants";
import { useTabRefresh } from "../../../hooks/useTabRefresh";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";
import { WeeklyEarningsChart } from "../../../components/worker-home/WeeklyEarningsChart";
import { weeklyEarnings } from "../../../utils/workerHome";
import XenditCheckoutModal from "../../../components/payment/XenditCheckoutModal";

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
  // What the worker owes HomeEase — commission on cash jobs (the client pays
  // the worker directly) plus any penalties. Netted from the next online payout.
  const [platformDues, setPlatformDues] = useState(0);
  const [payVisible, setPayVisible] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getTransactions();
      setTransactions(result.data);
    } catch (error) {
      console.error("Load earnings error:", error);
    }
    // Separate so a failure here doesn't blank the transactions.
    try {
      const profile = await api.getUserProfile();
      setPlatformDues(profile.platformDues ?? 0);
    } catch (error) {
      console.error("Load platform dues error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useTabRefresh("worker:earnings", load);
  const refreshControl = usePullToRefresh(load);

  const startPayment = async (amount?: number) => {
    if (paying) return;
    setPaying(true);
    try {
      const result = await api.payPlatformDues(amount);
      setPayVisible(false);
      if (result.alreadyPaid) {
        await load();
        return;
      }
      setCheckoutUrl(result.checkoutUrl);
    } catch (error: any) {
      Alert.alert("Couldn't start payment", error?.message || "Please try again.");
    } finally {
      setPaying(false);
    }
  };

  const submitCustomAmount = () => {
    const amount = Number(payAmount);
    if (!payAmount.trim() || !Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Enter an amount", "Type how much you want to pay.");
      return;
    }
    startPayment(amount);
  };

  const closeCheckout = () => {
    setCheckoutUrl(null);
    load();
  };

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
          refreshControl={refreshControl}
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

          {platformDues > 0 && (
            <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mx-4 mt-4">
              <View className="flex-row items-center">
                <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
                <Text className="text-warning font-bold text-sm ml-2 flex-1">Amount you owe HomeEase</Text>
              </View>
              <Text className="text-text-primary font-bold text-2xl mt-2">₱{platformDues.toFixed(2)}</Text>
              <Text className="text-text-secondary text-xs mt-1">
                This is HomeEase&apos;s platform fee for jobs the client paid you in cash, plus any penalties. It&apos;s
                taken out of your next online payout automatically, or you can pay it now.
              </Text>
              <Pressable
                onPress={() => startPayment()}
                disabled={paying}
                className="bg-accent rounded-xl py-3 mt-3 items-center"
              >
                <Text className="text-white font-semibold">
                  {paying ? "Opening..." : `Pay ₱${platformDues.toFixed(2)} now`}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setPayAmount("");
                  setPayVisible(true);
                }}
                className="py-2 mt-1 items-center"
              >
                <Text className="text-accent font-semibold text-sm">Pay a different amount</Text>
              </Pressable>
            </View>
          )}

          <WeeklyEarningsChart days={weeklyEarnings(transactions)} />

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
      <Modal visible={payVisible} transparent animationType="fade" onRequestClose={() => setPayVisible(false)}>
        <View className="flex-1 bg-black/50 justify-center px-6">
          <View className="bg-white rounded-2xl p-5">
            <Text className="text-text-primary font-bold text-lg">Pay HomeEase</Text>
            <Text className="text-text-secondary text-sm mt-1">
              You owe ₱{platformDues.toFixed(2)}. You can pay any amount from ₱{Math.min(platformDues, Math.max(platformDues / 2, 20)).toFixed(2)} (half of what you owe) up to the full amount.
            </Text>
            <TextInput
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="decimal-pad"
              placeholder="Amount in ₱"
              className="border border-gray-300 rounded-xl px-4 py-3 mt-3 text-text-primary"
            />
            <View className="flex-row gap-2 mt-4">
              <Pressable onPress={() => setPayVisible(false)} className="flex-1 py-3 items-center rounded-xl bg-card">
                <Text className="text-text-primary font-semibold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitCustomAmount}
                disabled={paying}
                className="flex-1 py-3 items-center rounded-xl bg-accent"
              >
                <Text className="text-white font-semibold">{paying ? "Opening..." : "Continue"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <XenditCheckoutModal
        visible={checkoutUrl !== null}
        checkoutUrl={checkoutUrl}
        onSuccess={closeCheckout}
        onFailed={closeCheckout}
        onCancel={closeCheckout}
      />
    </SafeAreaView>
  );
}
