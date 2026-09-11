import React, { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { Skeleton } from "../../../../components/ui/Skeleton";
import * as api from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

type BookingSummary = {
  id: string;
  service: string;
  scheduledDate: string;
  estimatedPrice: number;
  addOns?: { id: string; name: string; price: number }[];
};

export default function SubmitQuoteScreen() {
  const router = useRouter();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [fetching, setFetching] = useState(true);
  const alertModal = useAlertModal();

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

  const [materialsCost, setMaterialsCost] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const labor = booking?.estimatedPrice ?? 0;
  const addOns = booking?.addOns ?? [];
  const addOnsTotal = addOns.reduce((sum, a) => sum + a.price, 0);
  const materials = parseFloat(materialsCost) || 0;
  const total = labor + addOnsTotal + materials;

  if (fetching) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Submit Quote" showBack />
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
          <View className="bg-card rounded-2xl p-4 mb-6">
            <Skeleton width="25%" height={10} marginBottom={6} />
            <Skeleton width="60%" height={16} marginBottom={6} />
            <Skeleton width="40%" height={12} marginBottom={0} />
          </View>
          <Skeleton width="40%" height={16} marginBottom={16} />
          <Skeleton width="100%" height={48} borderRadius={12} marginBottom={16} />
          <Skeleton width="100%" height={48} borderRadius={12} marginBottom={16} />
          <Skeleton width="100%" height={80} borderRadius={12} marginBottom={0} />
        </ScrollView>
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
    setLoading(true);
    try {
      await api.submitQuote(booking.id, {
        materialsCost: materials,
        notes: notes.trim(),
      });

      alertModal.success(
        "Quote Submitted",
        "The client has been notified and will review your quote.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Submit quote error:", error);
      alertModal.error("Error", "Failed to submit your quote. Please try again.");
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
            Your labor cost was already settled when the client booked. If the
            job needs materials or extra costs beyond that, add them below —
            the client will approve or dispute before payment is processed.
          </Text>
        </View>

        {/* Cost Inputs */}
        <Text className="text-text-primary font-bold mb-4">Cost Breakdown</Text>

        <View className="bg-card rounded-xl px-3 py-3 mb-4 flex-row justify-between items-center">
          <Text className="text-text-secondary text-sm">
            Labor Cost (settled at booking)
          </Text>
          <Text className="text-text-primary font-semibold">
            ₱{labor.toFixed(2)}
          </Text>
        </View>

        {addOns.length > 0 && (
          <View className="bg-card rounded-xl px-3 py-3 mb-4">
            <Text className="text-text-secondary text-sm mb-2">
              Items already added on-site
            </Text>
            {addOns.map((item) => (
              <View key={item.id} className="flex-row justify-between items-center mb-1">
                <Text className="text-text-primary text-sm">{item.name}</Text>
                <Text className="text-text-primary font-semibold text-sm">
                  ₱{item.price.toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <InputField
          label="Additional Costs (₱) — optional"
          value={materialsCost}
          onChangeText={setMaterialsCost}
          placeholder="e.g. 200 for materials"
          keyboardType="numeric"
        />

        <InputField
          label="Notes for client — optional"
          value={notes}
          onChangeText={setNotes}
          placeholder="Describe the additional work or materials needed."
          multiline
        />

        {/* Live Total */}
        <View className="bg-success/10 border border-success/30 rounded-2xl p-4 mb-6">
          <Text className="text-text-secondary text-xs">Total Quote</Text>
          <Text className="text-success font-bold text-3xl mt-1">
            ₱{total.toFixed(2)}
          </Text>
          <View className="mt-2">
            <View className="flex-row justify-between">
              <Text className="text-text-muted text-xs">Labor (settled)</Text>
              <Text className="text-text-secondary text-xs">
                ₱{labor.toFixed(2)}
              </Text>
            </View>
            {addOnsTotal > 0 && (
              <View className="flex-row justify-between mt-1">
                <Text className="text-text-muted text-xs">Items added on-site</Text>
                <Text className="text-text-secondary text-xs">
                  ₱{addOnsTotal.toFixed(2)}
                </Text>
              </View>
            )}
            {materials > 0 && (
              <View className="flex-row justify-between mt-1">
                <Text className="text-text-muted text-xs">Additional Costs</Text>
                <Text className="text-text-secondary text-xs">
                  ₱{materials.toFixed(2)}
                </Text>
              </View>
            )}
          </View>
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

        <View className="gap-3">
          <PrimaryButton
            label="Submit Quote to Client"
            fullWidth
            disabled={loading}
            loading={loading}
            onPress={handleSubmit}
          />
          <OutlinedButton label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
