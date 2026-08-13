import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../../components/ui/Skeleton";
import PaymongoCheckoutModal from "../../../../components/payment/PaymongoCheckoutModal";
import * as api from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const TOPUP_METHODS: Array<{ value: "GCASH" | "MAYA"; label: string }> = [
  { value: "GCASH", label: "GCash" },
  { value: "MAYA", label: "Maya" },
];

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  TOPUP: "Top Up",
  ADMIN_FEE_DEDUCTION: "Admin Fee",
  REFUND: "Refund",
  ADMIN_ADJUSTMENT: "Adjustment",
};

export default function WalletScreen() {
  const alertModal = useAlertModal();
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<
    Awaited<ReturnType<typeof api.getMyWallet>>["transactions"]
  >([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState("");
  const [methodType, setMethodType] = useState<"GCASH" | "MAYA">("GCASH");
  const [submitting, setSubmitting] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const wallet = await api.getMyWallet();
      setBalance(wallet.balance);
      setTransactions(wallet.transactions);
    } catch (error) {
      console.error("Load wallet error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleTopUp = async () => {
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount < 50) {
      alertModal.warning("Invalid amount", "Enter an amount of at least ₱50.");
      return;
    }
    setSubmitting(true);
    try {
      const { checkoutUrl: url } = await api.topupWallet(parsedAmount, methodType);
      setCheckoutUrl(url);
      setCheckoutVisible(true);
    } catch (error) {
      console.error("Start wallet top-up error:", error);
      alertModal.error("Error", "Could not start the top-up. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const waitForTopupOutcome = async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const wallet = await api.getMyWallet();
      const latest = wallet.transactions[0];
      if (latest?.type === "TOPUP" && (latest.status === "COMPLETED" || latest.status === "FAILED")) {
        setBalance(wallet.balance);
        setTransactions(wallet.transactions);
        return latest;
      }
    }
    return null;
  };

  const handleCheckoutSuccess = async () => {
    setCheckoutVisible(false);
    setCheckoutUrl(null);
    setAmount("");
    const outcome = await waitForTopupOutcome();
    if (outcome?.status === "COMPLETED") {
      alertModal.success("Wallet Topped Up", "Your balance has been updated.");
    } else if (outcome?.status === "FAILED") {
      alertModal.error("Top-up failed", outcome.failureMessage || "The top-up couldn't be completed.");
    } else {
      alertModal.info("Still processing", "We're confirming your top-up. Check back on this screen in a moment.");
    }
    load();
  };

  const handleCheckoutFailed = () => {
    setCheckoutVisible(false);
    setCheckoutUrl(null);
    alertModal.error("Top-up failed", "The payment was not completed. You can try again.");
  };

  const handleCheckoutCancel = () => {
    setCheckoutVisible(false);
    setCheckoutUrl(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Wallet" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <View className="bg-brand rounded-2xl p-5 mb-6">
          <Text className="text-white/80 text-sm">Wallet Balance</Text>
          {loading ? (
            <Skeleton width={120} height={32} marginBottom={0} />
          ) : (
            <Text className="text-white font-bold text-3xl mt-1">₱{(balance ?? 0).toFixed(2)}</Text>
          )}
          <Text className="text-white/70 text-xs mt-2">
            Used to cover the admin fee deducted when you accept a job.
          </Text>
        </View>

        <Text className="text-text-primary font-bold text-lg mb-3">Top Up</Text>
        <View className="flex-row gap-2 mb-3">
          {TOPUP_METHODS.map((m) => {
            const isSelected = methodType === m.value;
            return (
              <Pressable
                key={m.value}
                onPress={() => setMethodType(m.value)}
                className={`flex-1 rounded-xl p-3 items-center border-2 ${
                  isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
                }`}
              >
                <Text className={`font-semibold text-sm ${isSelected ? "text-accent" : "text-text-primary"}`}>
                  {m.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="Amount (min ₱50)"
          keyboardType="numeric"
          className="bg-card rounded-xl px-4 py-3.5 text-text-primary mb-4"
          placeholderTextColor={colors.text.muted}
        />
        <PrimaryButton
          label="Top Up"
          fullWidth
          loading={submitting}
          onPress={handleTopUp}
        />

        <Text className="text-text-primary font-bold text-lg mt-8 mb-3">Transaction History</Text>
        {loading ? (
          <View>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} className="bg-card rounded-xl p-3 mb-2">
                <Skeleton width="60%" height={14} marginBottom={0} />
              </View>
            ))}
          </View>
        ) : transactions.length === 0 ? (
          <Text className="text-text-secondary text-sm">No wallet activity yet</Text>
        ) : (
          transactions.map((t) => (
            <View key={t.id} className="bg-card rounded-xl p-3 mb-2">
              <View className="flex-row items-center justify-between">
                <Text className="text-text-primary font-medium text-sm">
                  {TRANSACTION_TYPE_LABELS[t.type] ?? t.type}
                </Text>
                <Text className={`font-bold text-sm ${t.amount >= 0 ? "text-success" : "text-error"}`}>
                  {t.amount >= 0 ? "+" : ""}
                  {t.amount.toFixed(2)}
                </Text>
              </View>
              <Text className="text-text-muted text-xs mt-0.5">
                {new Date(t.createdAt).toLocaleDateString("en-PH", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
                {t.status !== "COMPLETED" ? ` · ${t.status}` : ""}
              </Text>
              {t.status === "FAILED" && t.failureMessage && (
                <Text className="text-error text-xs mt-1">{t.failureMessage}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>

      <PaymongoCheckoutModal
        visible={checkoutVisible}
        checkoutUrl={checkoutUrl}
        onSuccess={handleCheckoutSuccess}
        onFailed={handleCheckoutFailed}
        onCancel={handleCheckoutCancel}
      />
    </SafeAreaView>
  );
}
