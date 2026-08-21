import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import * as api from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function AddBookingAddOnScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const alertModal = useAlertModal();

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);

  const parsedPrice = parseFloat(price) || 0;
  const canSubmit = name.trim().length > 0 && parsedPrice > 0;

  const handleSubmit = async () => {
    if (!jobId || !canSubmit) return;

    setLoading(true);
    try {
      await api.addBookingAddOn(jobId, { name: name.trim(), price: parsedPrice });

      alertModal.success(
        "Item Added",
        "The client can see this added item and its cost on their booking.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Add booking addon error:", error);
      alertModal.error("Error", "Failed to add this item. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Add Item" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <View className="bg-accent/10 border border-accent/30 rounded-xl p-4 flex-row items-start mb-6">
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={colors.accent.DEFAULT}
          />
          <Text className="text-text-secondary text-sm ml-2 flex-1">
            Add an extra item or material you used on this job. It&apos;s added to
            the client&apos;s total immediately and they&apos;ll see it on their
            receipt.
          </Text>
        </View>

        <InputField
          label="Item name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Replacement faucet"
        />

        <InputField
          label="Price (₱)"
          value={price}
          onChangeText={setPrice}
          placeholder="e.g. 350"
          keyboardType="numeric"
        />

        {parsedPrice > 0 && (
          <View className="bg-success/10 border border-success/30 rounded-2xl p-4 mb-6">
            <Text className="text-text-secondary text-xs">Amount to add</Text>
            <Text className="text-success font-bold text-2xl mt-1">
              ₱{parsedPrice.toFixed(2)}
            </Text>
          </View>
        )}

        <View className="gap-3">
          <PrimaryButton
            label="Add to Booking"
            fullWidth
            disabled={!canSubmit || loading}
            loading={loading}
            onPress={handleSubmit}
          />
          <OutlinedButton label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
