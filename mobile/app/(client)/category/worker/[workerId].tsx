import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StarRating from "../../../../components/ui/StarRating";
import ReviewCard from "../../../../components/cards/ReviewCard";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import * as api from "../../../../services/api";
import type { WorkerDetail, WorkerReview } from "../../../../types/api.types";
import { useBookingStore } from "../../../../store/bookingStore";
import {
  mapServiceToCategory,
  isExactCategoryMatch,
} from "../../../../utils/categoryMapping";
import { colors } from "../../../../constants";

export default function WorkerProfileScreen() {
  const router = useRouter();
  const { workerId } = useLocalSearchParams<{ workerId: string }>();
  const setDraft = useBookingStore((s) => s.setDraft);

  const [worker, setWorker] = useState<WorkerDetail | null>(null);
  const [reviews, setReviews] = useState<WorkerReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!workerId) return;
      setLoading(true);
      try {
        const [detail, reviewsResult] = await Promise.all([
          api.getWorkerDetail(workerId),
          api.getWorkerReviews(workerId, 3),
        ]);
        if (!active) return;
        setWorker(detail);
        setReviews(reviewsResult.reviews);
      } catch (error) {
        console.error("Load worker profile error:", error);
        if (active) setWorker(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [workerId]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Worker" showBack />
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
        </View>
      </SafeAreaView>
    );
  }

  if (!worker) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Worker" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Worker not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="absolute top-0 left-0 right-0 z-10 pt-2">
        <ScreenHeader title="" showBack />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full h-64 bg-card-dark items-center justify-center">
          <Ionicons name="person-circle" size={100} color={colors.text.muted} />
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 -mt-8">
          <Text className="text-text-primary font-bold text-xl">{worker.name}</Text>
          <View className="flex-row items-center mt-1">
            <StarRating rating={worker.rating} size={16} />
            <Text className="text-text-muted text-sm ml-2">
              ({worker.reviews} reviews)
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-2 mt-2">
            <View className="bg-accent/20 rounded-full px-3 py-1">
              <Text className="text-accent text-xs">{worker.service}</Text>
            </View>
            <View
              className={`rounded-full px-3 py-1 ${
                worker.status === "available" ? "bg-success/20" : "bg-error/20"
              }`}
            >
              <Text
                className={`text-xs font-semibold ${
                  worker.status === "available" ? "text-success" : "text-error"
                }`}
              >
                {worker.status === "available" ? "Available" : "Busy"}
              </Text>
            </View>
          </View>
          {worker.activeJobCount > 0 && (
            <Text
              className={`${
                worker.activeJobCount === 1
                  ? "text-warning text-xs mt-1"
                  : "text-error text-xs mt-1"
              }`}
            >
              {worker.activeJobCount === 1
                ? "Currently handling 1 job"
                : `Currently handling ${worker.activeJobCount} jobs`}
            </Text>
          )}
          {typeof worker.rate === "number" && (
            <Text className="text-accent font-bold text-lg mt-2">
              ₱{worker.rate}/hr
            </Text>
          )}
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-text-primary font-bold mb-2">About</Text>
          <Text className="text-text-secondary text-sm">
            {worker.bio ||
              `Experienced ${worker.service.toLowerCase()} professional with great reviews. Book now for quality service.`}
          </Text>
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-text-primary font-bold mb-2">Skills</Text>
          <View className="flex-row flex-wrap gap-2">
            {worker.skills.map((skill) => (
              <View
                key={skill}
                className="bg-card-light rounded-full px-3 py-1"
              >
                <Text className="text-text-secondary text-xs">{skill}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-text-primary font-bold">Reviews</Text>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/(client)/category/worker/[workerId]/reviews",
                  params: {
                    workerId,
                    rating: String(worker.rating),
                    reviewCount: String(worker.reviews),
                  },
                })
              }
            >
              <Text className="text-accent text-sm">See All</Text>
            </Pressable>
          </View>
          {reviews.length === 0 ? (
            <Text className="text-text-secondary text-sm text-center py-4">
              No reviews yet
            </Text>
          ) : (
            reviews.map((r) => (
              <ReviewCard
                key={r.id}
                review={{
                  id: r.id,
                  authorName: r.clientName,
                  rating: r.rating,
                  comment: r.comment,
                  date: r.date,
                }}
              />
            ))
          )}
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-text-primary font-bold mb-3">
            Certifications
          </Text>
          {worker.certifications.length === 0 ? (
            <Text className="text-text-secondary text-sm text-center py-4">
              No certifications submitted yet
            </Text>
          ) : (
            worker.certifications.map((cert) => (
              <View
                key={cert.id}
                className="bg-card-light rounded-xl p-3 mb-2 flex-row items-center"
              >
                <Ionicons
                  name="document-text"
                  size={20}
                  color={colors.accent.DEFAULT}
                  style={{ marginRight: 8 }}
                />
                <View className="flex-1">
                  <Text className="text-brand text-sm font-semibold">
                    {cert.title}
                  </Text>
                  <Text className="text-text-muted text-xs">
                    {cert.issuer} · {cert.issueDate}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 bg-white p-4 border-t border-divider">
        <PrimaryButton
          label="Book Now"
          fullWidth
          onPress={() => {
            if (!isExactCategoryMatch(worker.service)) {
              Alert.alert(
                "Booking unavailable",
                "This worker's service type couldn't be matched to a bookable category. Please try again later or contact support.",
              );
              return;
            }

            const normalizedCategory = mapServiceToCategory(worker.service);
            setDraft({
              category: normalizedCategory,
              workerId: worker.id,
              workerLocked: true,
              entrySource: "worker_profile",
            });
            router.push("/(client)/booking/new/step-1");
          }}
        />
      </View>
    </SafeAreaView>
  );
}
