import React, { useCallback, useState } from "react";
import { View, Text, Image, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import StatusBadge from "../../../components/ui/StatusBadge";
import AddressMap from "../../../components/ui/AddressMap";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../components/ui/Skeleton";
import { API_STATUS_MAP } from "../../../store/bookingStore";
import * as api from "../../../services/api";
import { getWorkerNetAmount } from "../../../utils/pricing";

type BookingDetail = {
  id: string;
  client: { fullName: string };
  service: string;
  status: string;
  location: string | null;
  clientLat?: number | null;
  clientLng?: number | null;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
  payment: { methodType: string; workerPayout?: number | null } | null;
  notes: string | null;
  completionPhotoUrl?: string | null;
};

export default function RecordDetailScreen() {
  const router = useRouter();
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
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View className="items-center mb-4">
            <Skeleton width={90} height={22} borderRadius={11} marginBottom={0} />
          </View>
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Skeleton width="60%" height={18} marginBottom={8} />
            <Skeleton width="40%" height={12} marginBottom={16} />
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} className="flex-row justify-between mb-2">
                <Skeleton width="20%" height={10} marginBottom={0} />
                <Skeleton width="35%" height={12} marginBottom={0} />
              </View>
            ))}
          </View>
        </ScrollView>
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
  const amount = isCompleted ? getWorkerNetAmount(record) : record.finalPrice ?? record.estimatedPrice;

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
            <Text className="text-primary text-sm">{record.client.fullName}</Text>
          </View>
          <View className="flex-row justify-between mb-2">
            <Text className="text-text-muted text-xs">Address</Text>
            <Text className="text-primary text-sm text-right flex-1 ml-4">
              {record.location || "—"}
            </Text>
          </View>
          {record.payment ? (
            <View className="flex-row justify-between mb-2">
              <Text className="text-text-muted text-xs">Payment</Text>
              <Text className="text-primary text-sm">{record.payment.methodType}</Text>
            </View>
          ) : null}
          <View className="flex-row justify-between">
            <Text className="text-text-muted text-xs">
              {isCompleted ? "Earnings" : "Amount"}
            </Text>
            <Text className="text-primary text-sm">₱{amount.toFixed(2)}</Text>
          </View>
          {isCompleted && (
            <Text className="text-text-muted text-xs mt-1 text-right">
              After platform fee
            </Text>
          )}
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
              <AddressMap
                height="h-56"
                address={record.location}
                coords={record.clientLat != null && record.clientLng != null ? { lat: record.clientLat, lng: record.clientLng } : undefined}
              />
            </View>
            <PrimaryButton label="Open in Maps" onPress={openMap} />
          </>
        ) : null}

        {record.completionPhotoUrl && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold mb-2">
              Completion Photo
            </Text>
            <Image
              source={{ uri: record.completionPhotoUrl }}
              style={{ width: "100%", height: 180, borderRadius: 16 }}
              resizeMode="cover"
            />
          </View>
        )}

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

        {!isCompleted && !isCancelled && (
          <View className="mt-4">
            <PrimaryButton
              label="Manage Job"
              fullWidth
              onPress={() => router.push(`/(worker)/requests/job/${record.id}`)}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
