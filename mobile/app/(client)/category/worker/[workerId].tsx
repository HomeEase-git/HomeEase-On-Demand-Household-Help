import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StarRating from "../../../../components/ui/StarRating";
import ReviewCard from "../../../../components/cards/ReviewCard";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import * as api from "../../../../services/api";
import type { WorkerDetail, WorkerReview } from "../../../../types/api.types";
import { useBookingStore } from "../../../../store/bookingStore";
import { mapServiceToCategory } from "../../../../utils/categoryMapping";
import { colors, cardShadow } from "../../../../constants";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon -> Sun display order

function sortedAvailableDayLabels(days: (string | number)[]): string[] {
  const unique = Array.from(new Set(days.map((d) => Number(d))));
  return unique
    .filter((d) => d >= 0 && d <= 6)
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
    .map((d) => DAY_LABELS[d]);
}

function SectionTitle({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View className="flex-row items-center mb-2">
      <Ionicons name={icon} size={16} color={colors.brand.DEFAULT} />
      <Text className="text-text-primary font-bold ml-1.5">{label}</Text>
    </View>
  );
}

export default function WorkerProfileScreen() {
  const router = useRouter();
  const { workerId } = useLocalSearchParams<{ workerId: string }>();
  const setDraft = useBookingStore((s) => s.setDraft);
  const clearDraft = useBookingStore((s) => s.clearDraft);

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
          <ActivityIndicator size="small" color={colors.brand.DEFAULT} />
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

  const verifiedCertifications = worker.certifications.filter(
    (cert) => cert.verificationStatus === "APPROVED",
  );
  const pendingCertificationCount = worker.certifications.filter(
    (cert) => cert.verificationStatus === "PENDING",
  ).length;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="absolute top-2 left-4 z-10">
        <Pressable
          className="w-10 h-10 rounded-full items-center justify-center bg-black/35"
          onPress={() => router.back()}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={colors.white} />
        </Pressable>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full h-64 bg-card-dark items-center justify-center">
          {worker.avatar ? (
            <Image
              source={{ uri: worker.avatar }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : (
            <View className="w-24 h-24 rounded-full bg-white/60 items-center justify-center">
              <Ionicons name="person" size={56} color={colors.text.muted} />
            </View>
          )}
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 -mt-8" style={cardShadow}>
          <View className="flex-row items-center">
            <Text className="text-text-primary font-bold text-xl">{worker.name}</Text>
            {worker.verificationStatus === "VERIFIED" && (
              <Ionicons
                name="shield-checkmark"
                size={18}
                color={colors.success}
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
          <Pressable
            className="flex-row items-center mt-1"
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
            <StarRating rating={worker.rating} size={16} />
            <Text className="text-text-muted text-sm ml-2">
              ({worker.reviews} reviews)
            </Text>
          </Pressable>
          <View className="flex-row flex-wrap gap-2 mt-3">
            <View className="bg-accent/20 rounded-full px-3 py-1">
              <Text className="text-accent text-xs font-semibold">{worker.service}</Text>
            </View>
            <View
              className={`flex-row items-center rounded-full px-3 py-1 ${
                worker.status === "available" ? "bg-success/15" : "bg-error/15"
              }`}
            >
              <View
                className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                  worker.status === "available" ? "bg-success" : "bg-error"
                }`}
              />
              <Text
                className={`text-xs font-semibold ${
                  worker.status === "available" ? "text-success" : "text-error"
                }`}
              >
                {worker.status === "available" ? "Available" : "Busy"}
              </Text>
            </View>
            {typeof worker.resumeParseResult?.yearsOfExperience === "number" &&
              worker.resumeParseResult.yearsOfExperience > 0 && (
                <View className="bg-card-light rounded-full px-3 py-1">
                  <Text className="text-text-secondary text-xs">
                    {worker.resumeParseResult.yearsOfExperience}
                    {worker.resumeParseResult.yearsOfExperience === 1 ? " yr" : " yrs"} experience
                  </Text>
                </View>
              )}
            {worker.resumeParseResult?.masteryLevel && (
              <View className="bg-card-light rounded-full px-3 py-1">
                <Text className="text-text-secondary text-xs">
                  {worker.resumeParseResult.masteryLevel}
                </Text>
              </View>
            )}
          </View>
          {worker.activeJobCount > 0 && (
            <View
              className={`flex-row items-center self-start rounded-full px-2.5 py-1 mt-2 ${
                worker.activeJobCount === 1 ? "bg-warning/15" : "bg-error/15"
              }`}
            >
              <Ionicons
                name="briefcase-outline"
                size={12}
                color={worker.activeJobCount === 1 ? colors.warning : colors.error}
              />
              <Text
                className={`text-xs ml-1 ${
                  worker.activeJobCount === 1 ? "text-warning" : "text-error"
                }`}
              >
                {worker.activeJobCount === 1
                  ? "Currently handling 1 job"
                  : `Currently handling ${worker.activeJobCount} jobs`}
              </Text>
            </View>
          )}
          <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-divider">
            {typeof worker.rate === "number" ? (
              <Text className="text-accent font-bold text-lg">
                ₱{worker.rate}
                <Text className="text-text-muted text-xs font-normal">/hr</Text>
              </Text>
            ) : (
              <View />
            )}
            {worker.serviceAreaRadius > 0 && (
              <View className="flex-row items-center">
                <Ionicons name="location-outline" size={14} color={colors.text.muted} />
                <Text className="text-text-muted text-xs ml-1">
                  Serves within {worker.serviceAreaRadius} km
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3" style={cardShadow}>
          <SectionTitle icon="information-circle-outline" label="About" />
          <Text className="text-text-secondary text-sm">
            {worker.bio ||
              worker.resumeParseResult?.summary ||
              `Experienced ${worker.service.toLowerCase()} professional with great reviews. Book now for quality service.`}
          </Text>
        </View>

        {worker.availableDays.length > 0 && (
          <View className="bg-card rounded-2xl p-4 mx-4 mt-3" style={cardShadow}>
            <SectionTitle icon="calendar-outline" label="Availability" />
            <View className="flex-row flex-wrap gap-2">
              {sortedAvailableDayLabels(worker.availableDays).map((label) => (
                <View key={label} className="bg-card-light rounded-full px-3 py-1">
                  <Text className="text-text-secondary text-xs">{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3" style={cardShadow}>
          <SectionTitle icon="construct-outline" label="Skills" />
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

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3" style={cardShadow}>
          <View className="flex-row justify-between items-center mb-2">
            <SectionTitle icon="star-outline" label="Reviews" />
            <Pressable
              className="flex-row items-center"
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
              <Text className="text-accent text-sm font-semibold">See All</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent.DEFAULT} />
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
                  authorAvatar: r.clientAvatar,
                  rating: r.rating,
                  comment: r.comment,
                  date: r.date,
                }}
              />
            ))
          )}
        </View>

        <View className="bg-card rounded-2xl p-4 mx-4 mt-3" style={cardShadow}>
          <SectionTitle icon="ribbon-outline" label="Certifications" />
          {verifiedCertifications.length === 0 ? (
            <Text className="text-text-secondary text-sm text-center py-4">
              {pendingCertificationCount > 0
                ? "Certifications submitted, pending verification"
                : "No certifications submitted yet"}
            </Text>
          ) : (
            verifiedCertifications.map((cert) => (
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
                  <View className="flex-row items-center">
                    <Text className="text-brand text-sm font-semibold">
                      {cert.title}
                    </Text>
                    <Ionicons
                      name="checkmark-circle"
                      size={14}
                      color={colors.success}
                      style={{ marginLeft: 4 }}
                    />
                  </View>
                  <Text className="text-text-muted text-xs">
                    {cert.issuer} · {cert.issueDate}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 bg-white px-4 pt-3 pb-4 border-t border-divider flex-row items-center gap-3"
        style={{ ...cardShadow, shadowOffset: { width: 0, height: -2 } }}
      >
        {typeof worker.rate === "number" && (
          <View>
            <Text className="text-text-muted text-xs">Rate</Text>
            <Text className="text-text-primary font-bold text-base">
              ₱{worker.rate}
              <Text className="text-text-muted text-xs font-normal">/hr</Text>
            </Text>
          </View>
        )}
        <View className="flex-1">
          <PrimaryButton
            label="Book Now"
            fullWidth
            onPress={() => {
              // Start from a clean draft — otherwise an abandoned booking
              // attempt (different category/address/payment method) would
              // leak into this new worker-locked booking.
              clearDraft();
              const normalizedCategory = mapServiceToCategory(worker.service);
              const primaryServiceType = worker.services[0];
              setDraft({
                category: normalizedCategory,
                serviceType: worker.service,
                serviceTypeId: primaryServiceType?.id ?? null,
                categoryBasePrice: primaryServiceType?.basePrice ?? null,
                workerId: worker.id,
                workerName: worker.name,
                workerLocked: true,
                workerServiceTypes: worker.services,
                workerHourlyRate: worker.hourlyRate ?? null,
                workerTier: worker.tier ?? "STANDARD",
                workerAvatar: worker.avatar ?? null,
                workerRating: worker.rating ?? null,
                entrySource: "worker_profile",
              });
              router.push("/(client)/booking/new/step-1");
            }}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
