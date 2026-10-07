import React, { useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { BookingCard } from "../../../components/cards/BookingCard";
import { EmptyState } from "../../../components/feedback/EmptyState";
import { LoadingSkeleton } from "../../../components/feedback/LoadingSkeleton";
import { useBookingStore, type BookingStatus } from "../../../store/bookingStore";
import { colors } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { useTabRefresh } from "../../../hooks/useTabRefresh";
import { usePullToRefresh } from "../../../hooks/usePullToRefresh";

const TABS = ["Pending", "Active", "Completed", "Cancelled"] as const;

// Buckets the granular status into one of the four tabs shown on this screen
const TAB_STATUS_MAP: Record<(typeof TABS)[number], BookingStatus[]> = {
  Pending: ["Pending", "QuoteSubmitted"],
  // Disputed is a live job under review, not a cancelled one.
  Active: ["Accepted", "InProgress", "QuoteApproved", "PendingCompletion", "AwaitingPayment", "Disputed"],
  Completed: ["Completed"],
  Cancelled: ["Cancelled"],
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
  const hasMore = useBookingStore((s) => s.bookingsHasMore);
  const loadingMore = useBookingStore((s) => s.bookingsLoadingMore);
  const loadMoreBookings = useBookingStore((s) => s.loadMoreBookings);
  const clearDraft = useBookingStore((s) => s.clearDraft);

  const loadBookings = async () => {
    setLoading(true);
    try {
      await useBookingStore.getState().loadBookings();
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

  useTabRefresh("client:booking", loadBookings);
  const refreshControl = usePullToRefresh(loadBookings);

  const filtered = bookings.filter((b) => tabForStatus(b.status) === activeTab);

  // Tabs filter on the device, so a tab's bookings can sit on pages not
  // loaded yet. Keep paging until the tab has a screenful or pages run out.
  // Keyed on bookings.length (not loadingMore) so a failed page doesn't retry
  // in a loop while offline; pull-to-refresh starts over.
  const tabShort = filtered.length < 10;
  React.useEffect(() => {
    if (!loading && hasMore && tabShort) loadMoreBookings();
  }, [loading, hasMore, tabShort, bookings.length, loadMoreBookings]);

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

      {/* Skeleton only on the first load; a refresh keeps the list (and its spinner). */}
      {(loading && bookings.length === 0) || (filtered.length === 0 && hasMore) ? (
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
          refreshControl={refreshControl}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          onEndReached={loadMoreBookings}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator className="py-4" /> : null}
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              onPress={() => router.push(`/(client)/booking/${item.id}`)}
            />
          )}
        />
      )}

      {activeTab === "Pending" && (
        <Pressable accessibilityRole="button" accessibilityLabel="New booking"
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
