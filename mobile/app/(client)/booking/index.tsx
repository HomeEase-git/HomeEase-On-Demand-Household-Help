import React, { useState } from "react";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BookingCard } from "../../../components/cards/BookingCard";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { LoadingSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { useBookingStore, API_STATUS_MAP, type Booking, type BookingStatus } from "../../../store/bookingStore";
import { getBookings } from "../../../services/api";
import { colors } from "../../../constants";

const TABS = ["Pending", "Active", "Completed", "Cancelled"] as const;

// Buckets the granular status into one of the four tabs shown on this screen
function tabForStatus(status: BookingStatus): (typeof TABS)[number] {
  if (status === "Completed") return "Completed";
  if (status === "Cancelled") return "Cancelled";
  if (status === "Pending") return "Pending";
  return "Active";
}

type ApiBooking = {
  id: string;
  workerName: string | null;
  workerId: string | null;
  workerPhone: string | null;
  service: string;
  status: string;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
  rating: number | null;
};

function mapApiBooking(b: ApiBooking): Booking {
  return {
    id: b.id,
    service: b.service,
    worker: b.workerName ?? "Unassigned",
    workerId: b.workerId ?? undefined,
    workerPhone: b.workerPhone ?? undefined,
    date: b.scheduledDate,
    status: API_STATUS_MAP[b.status] ?? "Pending",
    amount: b.finalPrice ?? b.estimatedPrice,
    rating: b.rating ?? undefined,
  };
}

export default function MyBookingsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Pending");
  const [loading, setLoading] = useState(true);
  const bookings = useBookingStore((s) => s.bookings);
  const setBookings = useBookingStore((s) => s.setBookings);
  const clearDraft = useBookingStore((s) => s.clearDraft);

  const loadBookings = async () => {
    setLoading(true);
    try {
      const data: ApiBooking[] = await getBookings();
      setBookings(data.map(mapApiBooking));
    } catch (error) {
      console.error("Load bookings error:", error);
      Alert.alert("Error", "Failed to load your bookings");
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      setActiveTab("Pending");
      loadBookings();
    }, []),
  );

  const filtered = bookings.filter((b) => tabForStatus(b.status) === activeTab);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-4 pt-4 pb-2">
        <Text className="text-text-primary text-2xl font-bold">My Bookings</Text>
        <View className="flex-row mt-3 gap-2">
          {TABS.map((tab) => (
            <Pressable
              key={tab}
              className={`px-3 py-2 rounded-xl ${
                activeTab === tab ? "bg-accent" : "bg-card"
              }`}
              onPress={() => setActiveTab(tab)}
            >
              <Text
                className={
                  activeTab === tab
                    ? "text-white font-semibold text-sm"
                    : "text-text-secondary text-sm"
                }
              >
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading ? (
        <LoadingSkeleton type="booking" count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          subtitle={
            activeTab === "Pending"
              ? "Create a booking to get started"
              : `No ${activeTab.toLowerCase()} bookings`
          }
          actionLabel={activeTab === "Pending" ? "New Booking" : undefined}
          onAction={
            activeTab === "Pending"
              ? () => {
                  clearDraft();
                  router.push("/(client)/booking/new/step-1");
                }
              : undefined
          }
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              onPress={() => router.push(`/(client)/booking/${item.id}`)}
            />
          )}
        />
      )}

      {activeTab === "Pending" && (
        <Pressable
          className="absolute bottom-6 right-6 w-14 h-14 bg-accent rounded-full items-center justify-center"
          onPress={() => {
            clearDraft();
            router.push("/(client)/booking/new/step-1");
          }}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </Pressable>
      )}
    </SafeAreaView>
  );
}
