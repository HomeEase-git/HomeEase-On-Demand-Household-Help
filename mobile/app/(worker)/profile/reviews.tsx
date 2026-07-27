import React, { useEffect, useState } from "react";
import { View, Text, FlatList, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import ReviewCard from "../../../components/cards/ReviewCard";
import EmptyState from "../../../components/feedback/EmptyState";
import StarRating from "../../../components/ui/StarRating";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";

type ReviewItem = {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  date: string;
};

export default function WorkerReviewsScreen() {
  const user = useAuthStore((s) => s.user);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.id) return;
      setLoading(true);
      try {
        const result = await api.getWorkerReviews(user.id);
        if (!active) return;
        setReviews(
          result.reviews.map((r: any) => ({
            id: r.id,
            authorName: r.clientName,
            rating: r.rating,
            comment: r.comment,
            date: r.date,
          })),
        );
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
  }, [user?.id]);

  const calculateAverageRating = (): string => {
    if (reviews.length === 0) return "0.0";
    const sum = reviews.reduce((acc, review) => acc + review.rating, 0);
    return (sum / reviews.length).toFixed(1);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="My Reviews" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
        </View>
      </SafeAreaView>
    );
  }

  if (reviews.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="My Reviews" showBack />
        <EmptyState
          title="No reviews yet"
          subtitle="Completed jobs will show client reviews here."
        />
      </SafeAreaView>
    );
  }

  const averageRating = calculateAverageRating();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="My Reviews" showBack />
      <FlatList
        data={reviews}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ListHeaderComponent={
          <View className="bg-card rounded-2xl p-4 mx-0 mb-4 items-center">
            <Text className="text-text-primary font-bold text-3xl">
              {averageRating}
            </Text>
            <View className="mt-2">
              <StarRating rating={parseFloat(averageRating)} size={16} />
            </View>
            <Text className="text-text-muted text-xs mt-2">
              {reviews.length} review
              {reviews.length !== 1 ? "s" : ""}
            </Text>
          </View>
        }
        renderItem={({ item }) => <ReviewCard review={item} />}
      />
    </SafeAreaView>
  );
}
