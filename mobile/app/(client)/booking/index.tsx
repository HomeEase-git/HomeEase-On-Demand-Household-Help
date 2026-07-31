import React, { useState } from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { BookingCard } from "../../../components/cards/BookingCard";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { LoadingSkeleton } from "../../../components/feedback/LoadingSkeleton";
import {
  useBookingStore,
  mapApiBooking,
  type BookingStatus,
  type ApiBookingListItem,
} from "../../../store/bookingStore";
import { getBookings } from "../../../services/api";
import { colors } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

const TABS = ["Pending", "Active", "Completed", "Cancelled"] as const;

// Buckets the granular status into one of the four tabs shown on this screen
const TAB_STATUS_MAP: Record<(typeof TABS)[number], BookingStatus[]> = {
  Pending: ["Pending", "QuoteSubmitted"],
  Active: ["Accepted", "Active", "InProgress", "QuoteApproved", "PendingCompletion"],
  Completed: ["Completed"],
  Cancelled: ["Cancelled", "Disputed"],
};

function tabForStatus(status: BookingStatus): (typeof TABS)[number] {
  const match = (Object.keys(TAB_STATUS_MAP) as (typeof TABS)[number][]).find((tab) =>
    TAB_STATUS_MAP[tab].includes(status),
  );
  return match ?? "Active";
}

export default function MyBookingsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Pending");
  const [loading, setLoading] = useState(true);
  const bookings = useBookingStore((s) => s.bookings);
  const setBookings = useBookingStore((s) => s.setBookings);
  const clearDraft = useBookingStore((s) => s.clearDraft);

  const loadBookings = async () => {
    setLoading(true);
    try {
      const data: ApiBookingListItem[] = await getBookings();
      setBookings(data.map(mapApiBooking));
    } catch (error) {
      console.error("Load bookings error:", error);
      alertModal.error("Error", "Failed to load your bookings");
    } finally {
      setLoading(false);
    }
  };

  const hasMounted = React.useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      if (!hasMounted.current) {
        hasMounted.current = true;
        setActiveTab("Pending");
      }
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
