import React, { useEffect, useState } from "react";
import { View, Text, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../../components/ui/ScreenHeader";
import StarRating from "../../../../../components/ui/StarRating";
import ReviewCard from "../../../../../components/cards/ReviewCard";
import { SkeletonList, ReviewCardSkeleton } from "../../../../../components/ui/Skeleton";
import * as api from "../../../../../services/api";
import type { WorkerReview } from "../../../../../types/api.types";

export default function WorkerReviewsScreen() {
  const { workerId, rating, reviewCount } = useLocalSearchParams<{
    workerId: string;
    rating?: string;
    reviewCount?: string;
  }>();

  const [reviews, setReviews] = useState<WorkerReview[]>([]);
  const [distribution, setDistribution] = useState<Record<number, number>>({
    5: 0,
    4: 0,
    3: 0,
    2: 0,
    1: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!workerId) return;
      setLoading(true);
      try {
        const result = await api.getWorkerReviews(workerId);
        if (!active) return;
        setReviews(result.reviews);
        setDistribution(result.distribution);
      } catch (error) {
        console.error("Load worker reviews error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [workerId]);

  const displayRating = rating ? Number(rating) : reviews.length ? reviews[0].rating : 0;
  const displayCount = reviewCount ? Number(reviewCount) : reviews.length;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Reviews" showBack />
      <View className="px-4 flex-1">
        <View className="bg-card rounded-2xl p-4 mb-4">
          <View className="flex-row items-center">
            <Text className="text-text-primary text-4xl font-bold mr-3">
              {displayRating.toFixed(1)}
            </Text>
            <View>
              <StarRating rating={displayRating} size={20} />
              <Text className="text-text-muted text-sm mt-1">
                {displayCount} ratings
              </Text>
            </View>
          </View>
          <View className="mt-3">
            {[5, 4, 3, 2, 1].map((star) => (
              <View key={star} className="flex-row items-center mb-1">
                <Text className="text-text-secondary text-xs w-6">{star}</Text>
                <View className="flex-1 h-2 bg-card-dark rounded-full overflow-hidden">
                  <View
                    className="h-full bg-gold rounded-full"
                    style={{ width: `${distribution[star] ?? 0}%` }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
        {loading ? (
          <SkeletonList count={3} SkeletonComponent={ReviewCardSkeleton} />
        ) : reviews.length === 0 ? (
          <Text className="text-text-secondary text-sm text-center py-6">
            No reviews yet
          </Text>
        ) : (
          <FlatList
            data={reviews}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ReviewCard
                review={{
                  id: item.id,
                  authorName: item.clientName,
                  rating: item.rating,
                  comment: item.comment,
                  date: item.date,
                }}
              />
            )}
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
