import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Linking, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import StatusBadge from "../../../components/ui/StatusBadge";
import MapPlaceholder from "../../../components/ui/MapPlaceholder";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { API_STATUS_MAP } from "../../../store/bookingStore";
import * as api from "../../../services/api";

type BookingDetail = {
  id: string;
  client: { fullName: string };
  service: string;
  status: string;
  location: string | null;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
  payment: { methodType: string } | null;
  notes: string | null;
};

export default function RecordDetailScreen() {
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const [record, setRecord] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    try {
      const detail = await api.getBookingDetail(recordId);
      setRecord(detail);
    } catch (error) {
      console.error("Load record detail error:", error);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Job Record" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
        </View>
      </SafeAreaView>
    );
  }

  if (!record) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Job Record" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = API_STATUS_MAP[record.status] ?? "Pending";
  const isCompleted = status === "Completed";
  const isCancelled = status === "Cancelled";
  const amount = record.finalPrice ?? record.estimatedPrice;

  const openMap = async () => {
    if (!record.location) return;
    const url = `https://www.openstreetmap.org/search?query=${encodeURIComponent(
      record.location,
    )}`;
    await Linking.openURL(url);
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Job Record" showBack />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View className="items-center mb-4">
          <StatusBadge status={status as any} />
        </View>

        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold text-lg mb-1">
            {record.service}
          </Text>
          <Text className="text-text-secondary text-sm mb-3">
            {record.scheduledDate}
          </Text>

          <View className="flex-row justify-between mb-2">
            <Text className="text-text-muted text-xs">Client</Text>
            <Text className="text-brand text-sm">{record.client.fullName}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-text-muted text-xs">Address</Text>
            <Text className="text-brand text-sm text-right flex-1 ml-4">
              {record.location || "—"}
            </Text>
          </View>
          {record.payment ? (
            <View className="flex-row justify-between mb-2">
              <Text className="text-text-muted text-xs">Payment</Text>
              <Text className="text-brand text-sm">{record.payment.methodType}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-between">
            <Text className="text-text-muted text-xs">Earnings</Text>
            <Text className="text-brand text-sm">₱{amount}.00</Text>
          </View>
        </View>

        {record.notes ? (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold mb-2">Notes</Text>
            <Text className="text-text-secondary text-sm">{record.notes}</Text>
          </View>
        ) : null}

        {record.location ? (
          <>
            <View className="mb-3">
              <MapPlaceholder height="h-56" label="Navigate to Job" />
            </View>
            <PrimaryButton label="Open in Maps" onPress={openMap} />
          </>
        ) : null}

        {(isCompleted || isCancelled) && (
          <View className="bg-card rounded-2xl p-4 mt-4">
            <Text className="text-text-primary font-bold mb-2">Summary</Text>
            <Text className="text-text-secondary text-sm mb-1">
              {isCompleted
                ? "This job was completed successfully."
                : "This booking was cancelled."}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
