import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import * as api from "../../../../services/api";
import { colors } from "../../../../constants";

type BookingSummary = {
  id: string;
  service: string;
  scheduledDate: string;
};

export default function SubmitQuoteScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!requestId) return;
      setFetching(true);
      try {
        const detail = await api.getBookingDetail(requestId);
        if (active) setBooking(detail);
      } catch (error) {
        console.error("Load booking for quote error:", error);
      } finally {
        if (active) setFetching(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [requestId]);

  const [laborCost, setLaborCost] = useState("");
  const [materialsCost, setMaterialsCost] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const labor = parseFloat(laborCost) || 0;
  const materials = parseFloat(materialsCost) || 0;
  const total = labor + materials;

  const canSubmit = labor > 0;

  if (fetching) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Submit Quote" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Submit Quote" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Booking not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSubmit = async () => {
    if (!canSubmit) {
      Alert.alert("Error", "Please enter the labor cost.");
      return;
    }

    setLoading(true);
    try {
      await api.submitQuote(booking.id, {
        laborCost: labor,
        materialsCost: materials,
        notes: notes.trim(),
      });

      Alert.alert(
        "Quote Submitted",
        "The client has been notified and will review your quote.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Submit quote error:", error);
      Alert.alert("Error", "Failed to submit your quote. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Submit Quote" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        {/* Booking Summary */}
        <View className="bg-card rounded-2xl p-4 mb-6">
          <Text className="text-text-secondary text-xs mb-1">Booking</Text>
          <Text className="text-text-primary font-bold">{booking.service}</Text>
          <Text className="text-text-secondary text-sm mt-1">
            {booking.scheduledDate}
          </Text>
        </View>

        {/* Info Banner */}
        <View className="bg-accent/10 border border-accent/30 rounded-xl p-4 flex-row items-start mb-6">
          <Ionicons
            name="information-circle-outline"
            size={20}
            color={colors.accent.DEFAULT}
          />
          <Text className="text-text-secondary text-sm ml-2 flex-1">
            After your inspection, submit a quote with your labor cost and any
            materials needed. The client will approve or dispute before payment
            is processed.
          </Text>
        </View>

        {/* Cost Inputs */}
        <Text className="text-text-primary font-bold mb-4">Cost Breakdown</Text>

        <InputField
          label="Labor Cost (₱)"
          value={laborCost}
          onChangeText={setLaborCost}
          placeholder="e.g. 500"
          keyboardType="numeric"
        />

        <InputField
          label="Materials Cost (₱) — optional"
          value={materialsCost}
          onChangeText={setMaterialsCost}
          placeholder="e.g. 200"
          keyboardType="numeric"
        />

        <InputField
          label="Notes for client — optional"
          value={notes}
          onChangeText={setNotes}
          placeholder="Describe the work needed, parts to be replaced, etc."
          multiline
        />

        {/* Live Total */}
        {total > 0 && (
          <View className="bg-success/10 border border-success/30 rounded-2xl p-4 mb-6">
            <Text className="text-text-secondary text-xs">Total Quote</Text>
            <Text className="text-success font-bold text-3xl mt-1">
              ₱{total.toFixed(2)}
            </Text>
            {materials > 0 && (
              <View className="mt-2">
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-xs">Labor</Text>
                  <Text className="text-text-secondary text-xs">
                    ₱{labor.toFixed(2)}
                  </Text>
                </View>
                <View className="flex-row justify-between mt-1">
                  <Text className="text-text-muted text-xs">Materials</Text>
                  <Text className="text-text-secondary text-xs">
                    ₱{materials.toFixed(2)}
                  </Text>
                </View>
              </View>
            )}
            <View className="border-t border-success/20 mt-2 pt-2">
              <View className="flex-row justify-between">
                <Text className="text-text-muted text-xs">
                  Your earnings (after 10% fee)
                </Text>
                <Text className="text-success text-xs font-semibold">
                  ₱{(total * 0.9).toFixed(2)}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View className="gap-3">
          <PrimaryButton
            label="Submit Quote to Client"
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
