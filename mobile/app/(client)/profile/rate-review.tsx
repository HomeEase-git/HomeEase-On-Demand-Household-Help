import React, { useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import EmptyState from "../../../components/feedback/EmptyState";
import {
  useBookingStore,
  mapApiBooking,
  type ApiBookingListItem,
} from "../../../store/bookingStore";
import { getBookings } from "../../../services/api";

export default function RateReviewScreen() {
  const router = useRouter();
  const bookings = useBookingStore((s) => s.bookings);
  const setBookings = useBookingStore((s) => s.setBookings);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const data: ApiBookingListItem[] = await getBookings();
          if (!cancelled) setBookings(data.map(mapApiBooking));
        } catch (error) {
          console.error("Load bookings error:", error);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [setBookings]),
  );

  const completedWithoutReview = bookings.filter(
    (b) => b.status === "Completed" && typeof b.rating !== "number",
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Rate Bookings" showBack />
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
        </View>
      ) : completedWithoutReview.length === 0 ? (
        <EmptyState
          icon="star-outline"
          title="Nothing to rate"
          subtitle="You have no completed bookings waiting for a review."
        />
      ) : (
        <FlatList
          data={completedWithoutReview}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <Pressable
              className="bg-card rounded-2xl p-4 mb-3"
              onPress={() =>
                router.push({
                  pathname: "/(client)/profile/rate-review/[bookingId]",
                  params: { bookingId: item.id },
                })
              }
            >
              <View className="flex-row justify-between items-center mb-1">
                <Text className="text-primary font-semibold">
                  {item.service}
                </Text>
                <Text className="text-accent text-xs">{item.date}</Text>
              </View>
              <Text className="text-text-secondary text-sm mb-1">
                With {item.worker}
              </Text>
              <Text className="text-text-muted text-xs">
                Tap to rate this booking
              </Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
