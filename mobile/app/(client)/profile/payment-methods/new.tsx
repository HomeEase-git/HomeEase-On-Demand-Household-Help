import React, { useState, useRef } from "react";
import {
  TextInput,
  ScrollView,
  View,
  Text,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import * as api from "../../../../services/api";
import { cardShadow } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function AddPaymentMethodScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [type, setType] = useState<"GCASH" | "MAYA" | "CASH">("GCASH");
  const [accountIdentifier, setAccountIdentifier] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);

  const accountRef = useRef<TextInput>(null);
  const labelRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    if (!accountIdentifier.trim()) {
      alertModal.error("Error", "Please enter your payment account identifier");
      return;
    }

    setLoading(true);
    try {
      await api.addPaymentMethod({
        type,
        accountIdentifier: accountIdentifier.trim(),
        label:
          label.trim() || `${type} ending in ...${accountIdentifier.slice(-4)}`,
      });
      alertModal.success("Success", "Payment method added successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Add payment method error:", error);
      alertModal.error("Error", "Unable to add payment method");
    } finally {
      setLoading(false);
    }
  };

  const types = [
    { label: "GCash", value: "GCASH" as const },
    { label: "Maya", value: "MAYA" as const },
    { label: "Cash", value: "CASH" as const },
  ];

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Add Payment Method" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-primary text-sm mb-2 font-semibold">
            Payment Type
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {types.map((t) => (
              <Pressable
                key={t.value}
                className={`px-3 py-2 rounded-lg ${
                  type === t.value ? "bg-accent" : "bg-white"
                }`}
                onPress={() => setType(t.value)}
              >
                <Text
                  className={
                    type === t.value
                      ? "text-white font-semibold text-sm"
                      : "text-text-secondary text-sm"
                  }
                >
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <InputField
          ref={accountRef}
          label="Account Identifier"
          placeholder="e.g., +63912345678 (for GCash/Maya), account number, etc."
          value={accountIdentifier}
          onChangeText={setAccountIdentifier}
          returnKeyType="next"
          onSubmitEditing={() => labelRef.current?.focus()}
        />

        <InputField
          ref={labelRef}
          label="Label (Optional)"
          placeholder="e.g., My GCash, Work Card"
          value={label}
          onChangeText={setLabel}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        <PrimaryButton
          label="Add Payment Method"
          fullWidth
          onPress={handleSubmit}
          loading={loading}
          disabled={loading}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
