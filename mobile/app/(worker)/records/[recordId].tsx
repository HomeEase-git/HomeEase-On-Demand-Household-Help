import React from "react";
import { View, Text, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import StatusBadge from "../../../components/ui/StatusBadge";
import MapPlaceholder from "../../../components/ui/MapPlaceholder";
import PrimaryButton from "../../../components/ui/PrimaryButton";

const RECORDS: Record<
  string,
  {
    client: string;
    service: string;
    date: string;
    time: string;
    address: string;
    duration: string;
    paymentMethod: string;
    amount: number;
    status: string;
    notes: string;
    rating: number;
    reviews: number;
  }
> = {
  rec1: {
    client: "Carlo Mendoza",
    service: "House Cleaning",
    date: "2026-03-01",
    amount: 400,
    status: "Completed",
  },
  rec2: {
    client: "Liza Torres",
    service: "Plumbing",
    date: "2026-02-28",
    amount: 500,
    status: "Cancelled",
  },
  rec3: {
    client: "Anna Cruz",
    service: "Aircon Maintenance",
    date: "2026-03-05",
    time: "10:00 AM",
    address: "1800 McKinley St., Makati, Philippines",
    duration: "3 hrs",
    paymentMethod: "GCash",
    amount: 650,
    status: "Ongoing",
    notes: "Replace filter, check refrigerant, and test cooling performance.",
    rating: 4.8,
    reviews: 18,
  },
};

export default function RecordDetailScreen() {
  const router = useRouter();
  const { recordId } = useLocalSearchParams<{ recordId: string }>();
  const record = recordId ? RECORDS[recordId] : null;

  if (!record) {
    return (
      <SafeAreaView className="flex-1 bg-primary-white">
        <ScreenHeader title="Job Record" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isCompleted = record.status === "Completed";
  const isCancelled = record.status === "Cancelled";
  const isOngoing = record.status === "Ongoing";

  const openMap = async () => {
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      record.address,
    )}`;

    await Linking.openURL(url);
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="Job Record" showBack />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <View className="items-center mb-4">
          <StatusBadge status={record.status as any} />
        </View>

        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-primary font-bold text-lg mb-1">
            {record.service}
          </Text>
          <Text className="text-text-secondary text-sm mb-3">
            {record.date} · {record.time} · {record.duration}
          </Text>

          <View className="flex-row justify-between mb-2">
            <Text className="text-text-muted text-xs">Client</Text>
            <Text className="text-primary text-sm">{record.client}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-text-muted text-xs">Address</Text>
            <Text className="text-primary text-sm text-right flex-1 ml-4">
              {record.address}
            </Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-text-muted text-xs">Payment</Text>
            <Text className="text-primary text-sm">{record.paymentMethod}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-text-muted text-xs">Earnings</Text>
            <Text className="text-primary text-sm">₱{record.amount}.00</Text>
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-primary font-bold mb-2">Client Details</Text>
          <Text className="text-text-secondary text-sm mb-1">
            {record.rating} stars · {record.reviews} reviews
          </Text>
          <Text className="text-text-secondary text-sm">{record.notes}</Text>
        </View>

        <View className="mb-3">
          <MapPlaceholder height="h-56" label="Navigate to Job" />
        </View>

        <PrimaryButton label="Open in Maps" onPress={openMap} />

        {(isCompleted || isCancelled) && (
          <View className="bg-card rounded-2xl p-4 mt-4">
            <Text className="text-primary font-bold mb-2">Summary</Text>
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
