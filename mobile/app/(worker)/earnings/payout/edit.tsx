import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const METHODS: { id: "GCASH" | "MAYA" | "BANK_TRANSFER"; label: string; icon: string }[] = [
  { id: "GCASH", label: "GCash", icon: "G" },
  { id: "MAYA", label: "Maya", icon: "M" },
  { id: "BANK_TRANSFER", label: "Bank Transfer", icon: "B" },
];

export default function PayoutEditScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<"GCASH" | "MAYA" | "BANK_TRANSFER">("GCASH");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const alertModal = useAlertModal();

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const current = await api.getPayoutMethod();
        if (!active) return;
        if (current.payoutMethod) setSelected(current.payoutMethod);
        if (current.payoutAccountName) setAccountName(current.payoutAccountName);
        if (current.payoutAccountNumber) setAccountNumber(current.payoutAccountNumber);
      } catch (error) {
        console.error("Load payout method error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    if (!accountName.trim() || !accountNumber.trim()) {
      alertModal.error("Error", "Please enter the account name and number.");
      return;
    }
    setSaving(true);
    try {
      await api.updatePayoutMethod({
        payoutMethod: selected,
        payoutAccountName: accountName.trim(),
        payoutAccountNumber: accountNumber.trim(),
      });
      alertModal.success("Saved", "Payout method updated");
      router.back();
    } catch (error) {
      console.error("Save payout method error:", error);
      alertModal.error("Error", "Failed to update payout method. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Set Payout Method" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Set Payout Method" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {METHODS.map((m) => (
          <Pressable
            key={m.id}
            className={`bg-card rounded-xl p-4 mb-2 flex-row items-center ${
              selected === m.id ? "border-2 border-accent" : ""
            }`}
            onPress={() => setSelected(m.id)}
          >
            <View className="w-10 h-10 bg-card-light rounded-full items-center justify-center mr-3">
              <Text className="text-text-primary font-bold">{m.icon}</Text>
            </View>
            <Text className="text-primary font-semibold">{m.label}</Text>
          </Pressable>
        ))}
        <View className="mt-2">
          <InputField
            label="Account Name"
            value={accountName}
            onChangeText={setAccountName}
            placeholder="e.g. Juan Dela Cruz"
          />
          <InputField
            label={selected === "BANK_TRANSFER" ? "Bank Account Number" : "Mobile Number"}
            value={accountNumber}
            onChangeText={setAccountNumber}
            placeholder={selected === "BANK_TRANSFER" ? "e.g. 1234567890" : "e.g. 09171234567"}
            keyboardType={selected === "BANK_TRANSFER" ? "default" : "phone-pad"}
          />
        </View>
        <PrimaryButton
          label="Save Payout Method"
          fullWidth
          onPress={handleSave}
          disabled={saving}
          loading={saving}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
