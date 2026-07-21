import React from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StarRating from "../../../../components/ui/StarRating";
import ReviewCard from "../../../../components/cards/ReviewCard";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import {
  workers,
  workerActiveJobs,
  workerDocuments,
} from "../../../../constants/dummyData";
import { useBookingStore } from "../../../../store/bookingStore";
import {
  mapServiceToCategory,
  isExactCategoryMatch,
} from "../../../../utils/categoryMapping";
import { colors } from "../../../../constants";

const MOCK_REVIEWS = [
  {
    id: "r1",
    authorName: "Client A",
    rating: 5,
    comment: "Very professional and fast.",
    date: "Mar 1, 2026",
  },
  {
    id: "r2",
    authorName: "Client B",
    rating: 4,
    comment: "Good job, would book again.",
    date: "Feb 28, 2026",
  },
];

export default function WorkerProfileScreen() {
  const router = useRouter();
  const { workerId } = useLocalSearchParams<{ workerId: string }>();
  const worker = workers.find((w) => w.id === workerId);
  const setDraft = useBookingStore((s) => s.setDraft);

  if (!worker) {
    return (
      <SafeAreaView className="flex-1 bg-primary-white">
        <ScreenHeader title="Worker" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Worker not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <View className="absolute top-0 left-0 right-0 z-10 pt-2">
        <ScreenHeader title="" showBack />
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full h-64 bg-card-dark items-center justify-center">
          {/* TODO: Replace with worker profile photo */}
          <Ionicons name="person-circle" size={100} color={colors.text.muted} />
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 -mt-8">
          <Text className="text-primary font-bold text-xl">{worker.name}</Text>
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
          {(() => {
            const activeJobs = workerActiveJobs[worker.id];
            if (!activeJobs || activeJobs === 0) return null;
            return (
              <Text
                className={`${
                  activeJobs === 1
                    ? "text-warning text-xs mt-1"
                    : "text-error text-xs mt-1"
                }`}
              >
                {activeJobs === 1
                  ? "Currently handling 1 job"
                  : `Currently handling ${activeJobs} jobs`}
              </Text>
            );
          })()}
          <Text className="text-accent font-bold text-lg mt-2">
            ₱{worker.rate}/hr
          </Text>
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-primary font-bold mb-2">About</Text>
          <Text className="text-text-secondary text-sm">
            Experienced {worker.service.toLowerCase()} professional with great
            reviews. Book now for quality service.
          </Text>
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-primary font-bold mb-2">Skills</Text>
          <View className="flex-row flex-wrap gap-2">
            {[worker.service, "Installation", "Repair"].map((skill) => (
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
            <Text className="text-primary font-bold">Reviews</Text>
            <Pressable
              onPress={() =>
                router.push(`/(client)/category/worker/${workerId}/reviews`)
              }
            >
              <Text className="text-accent text-sm">See All</Text>
            </Pressable>
          </View>
          {MOCK_REVIEWS.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3">
          <Text className="text-primary font-bold mb-3">
            Documents Submitted
          </Text>
          {(() => {
            const documents = workerDocuments[worker.id] || [];
            if (documents.length === 0) {
              return (
                <Text className="text-text-secondary text-sm text-center py-4">
                  No documents submitted yet
                </Text>
              );
            }
            return documents.map((doc) => (
              <View
                key={doc.id}
                className="bg-card-light rounded-xl p-3 mb-2 flex-row items-center"
              >
                <Ionicons
                  name="document-text"
                  size={20}
                  color={colors.accent.DEFAULT}
                  style={{ marginRight: 8 }}
                />
                <View className="flex-1">
                  <Text className="text-primary text-sm font-semibold">
                    {doc.type}
                  </Text>
                  <Text className="text-text-muted text-xs">
                    {doc.uploadDate}
                  </Text>
                </View>
              </View>
            ));
          })()}
        </View>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 bg-primary-white p-4 border-t border-divider">
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
