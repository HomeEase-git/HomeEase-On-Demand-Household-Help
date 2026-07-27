import React from "react";
import { View, Text, FlatList, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import EmptyState from "../../../components/feedback/EmptyState";
import { useBookingStore } from "../../../store/bookingStore";

export default function RateReviewScreen() {
  const router = useRouter();
  const bookings = useBookingStore((s) => s.bookings);

  const completedWithoutReview = bookings.filter(
    (b) => b.status === "Completed" && typeof b.rating !== "number",
  );

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Rate Bookings" showBack />
      {completedWithoutReview.length === 0 ? (
        <EmptyState
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
                <Text className="text-brand font-semibold">
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
