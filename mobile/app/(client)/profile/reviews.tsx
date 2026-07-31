import React, { useEffect, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import ReviewCard from "../../../components/cards/ReviewCard";
import EmptyState from "../../../components/feedback/EmptyState";
import { SkeletonList, ReviewCardSkeleton } from "../../../components/ui/Skeleton";
import * as api from "../../../services/api";

export default function ReviewsScreen() {
  const [reviews, setReviews] = useState<Awaited<ReturnType<typeof api.getMyReviews>>["data"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      try {
        const result = await api.getMyReviews();
        if (!active) return;
        setReviews(result.data);
      } catch (error) {
        console.error("Load my reviews error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="My Reviews" showBack />
      {loading ? (
        <View className="p-4">
          <SkeletonList count={4} SkeletonComponent={ReviewCardSkeleton} />
        </View>
      ) : reviews.length === 0 ? (
        <EmptyState
          icon="star-outline"
          title="No reviews yet"
          subtitle="Reviews you leave for workers will show up here."
        />
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <ReviewCard
              review={{
                id: item.id,
                authorName: item.workerName,
                rating: item.rating,
                comment: item.comment,
                date: item.date,
              }}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
