import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import SectionHeader from "../../../components/ui/SectionHeader";
import RequestCard from "../../../components/cards/RequestCard";
import NotificationBadge from "../../../components/ui/NotificationBadge";
import { useWorkerStore, mapApiJob, type ApiWorkerBooking } from "../../../store/workerStore";
import { useAuthStore } from "../../../store/authStore";
import { useNotificationStore } from "../../../store/notificationStore";
import * as api from "../../../services/api";
import { colors } from "../../../constants";

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function WorkerHomeScreen() {
  const router = useRouter();
  const available = useWorkerStore((s) => s.available);
  const setAvailable = useWorkerStore((s) => s.setAvailable);
  const jobs = useWorkerStore((s) => s.jobs);
  const setJobs = useWorkerStore((s) => s.setJobs);
  const user = useAuthStore((s) => s.user);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [togglingAvailability, setTogglingAvailability] = useState(false);

  const firstName = user?.name?.split(" ")[0] ?? "Worker";
  const pending = jobs.filter((j) => j.status === "Pending");
  const today = todayStr();
  const todayJobs = jobs.filter((j) => j.scheduledDate?.slice(0, 10) === today);
  const todayEarnings = jobs
    .filter((j) => j.status === "Completed" && j.scheduledDate?.slice(0, 10) === today)
    .reduce((sum, j) => sum + (j.finalPrice ?? j.estimatedPrice), 0);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [bookings, detail] = await Promise.all([
        api.getBookings(),
        api.getWorkerDetail(user.id),
      ]);
      setJobs((bookings as ApiWorkerBooking[]).map(mapApiJob));
      if (detail) setAvailable(detail.isAvailable);
    } catch (error) {
      console.error("Load worker home error:", error);
    }
  }, [user?.id, setJobs, setAvailable]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const handleToggleAvailability = async () => {
    if (togglingAvailability) return;
    const next = !available;
    setTogglingAvailability(true);
    try {
      const result = await api.updateAvailability(next);
      setAvailable(result.isAvailable ?? next);
    } catch (error) {
      console.error("Toggle availability error:", error);
      Alert.alert("Error", "Failed to update availability.");
    } finally {
      setTogglingAvailability(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        stickyHeaderIndices={[0]}
      >
        <View className="flex-row items-center justify-between px-4 pt-2 pb-2 bg-white z-10">
          <Text className="text-text-primary text-xl font-bold">HomeEase</Text>
          <Pressable
            className="p-2"
            onPress={() => router.push("/(worker)/inbox")}
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={colors.brand.dark}
            />
            <NotificationBadge count={unreadCount} />
          </Pressable>
        </View>

        <View className="bg-card rounded-2xl p-5 mx-4 mt-4">
          <Text className="text-text-primary font-bold text-xl">
            Hello, {firstName}! 👋
          </Text>
          <Text className="text-text-secondary text-sm mt-1">
            Here&apos;s your status today
          </Text>
        </View>

        <View className="bg-card-light rounded-2xl p-4 mx-4 mt-3 flex-row items-center">
          <View
            className={`w-3 h-3 rounded-full mr-3 ${
              available ? "bg-success" : "bg-error"
            }`}
          />
          <Text className="text-text-primary font-bold flex-1">
            I&apos;m {available ? "Available" : "Unavailable"}
          </Text>
          <Pressable
            className={`w-12 h-7 rounded-full ${
              available ? "bg-accent" : "bg-card-dark"
            }`}
            onPress={handleToggleAvailability}
            disabled={togglingAvailability}
          >
            <View
              className={`w-5 h-5 rounded-full bg-white mt-1 ${
                available ? "ml-6" : "ml-1"
              }`}
            />
          </Pressable>
        </View>
        <Text
          className={`${
            available ? "text-success" : "text-error"
          } text-xs mx-4 mt-1`}
        >
          Clients {available ? "can" : "cannot"} find and book you
        </Text>

        <View className="flex-row mx-4 mt-3 gap-2">
          <View className="flex-1 bg-card rounded-xl p-3 items-center">
            <Text className="text-accent font-bold text-2xl">{todayJobs.length}</Text>
            <Text className="text-text-secondary text-xs">
              Today&apos;s Jobs
            </Text>
          </View>
          <View className="flex-1 bg-card rounded-xl p-3 items-center">
            <Text className="text-warning font-bold text-2xl">
              {pending.length}
            </Text>
            <Text className="text-text-secondary text-xs">Pending</Text>
          </View>
          <View className="flex-1 bg-card rounded-xl p-3 items-center">
            <Text className="text-success font-bold text-xl">
              ₱{todayEarnings}
            </Text>
            <Text className="text-text-secondary text-xs">Earned Today</Text>
          </View>
        </View>

        <View className="mx-4 mt-4">
          <SectionHeader
            title="Upcoming Jobs"
            actionLabel="View All"
            onActionPress={() => router.push("/(worker)/requests")}
          />
          {pending.length === 0 ? (
            <View className="bg-card rounded-2xl p-4 items-center">
              <Text className="text-text-secondary text-sm">
                No pending job requests
              </Text>
            </View>
          ) : (
            pending
              .slice(0, 2)
              .map((job) => (
                <RequestCard
                  key={job.id}
                  request={{
                    id: job.id,
                    client: job.clientName,
                    service: job.service,
                    date: job.scheduledDate,
                    amount: job.finalPrice ?? job.estimatedPrice,
                    status: job.status,
                  }}
                  onPress={() => router.push(`/(worker)/requests/${job.id}`)}
                />
              ))
          )}
        </View>

        <View className="mx-4 mt-4">
          <SectionHeader title="Quick Actions" />
          <View className="flex-row flex-wrap gap-3 mt-2">
            <Pressable
              className="flex-1 min-w-[140] bg-brand/25 border-2 border-brand rounded-xl p-4"
              onPress={() => router.push("/(worker)/profile/availability")}
            >
              <Ionicons
                name="calendar-outline"
                size={24}
                color={colors.brand.DEFAULT}
              />
              <Text className="text-brand font-semibold mt-2">
                Set Availability
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 min-w-[140] bg-green-100 border-2 border-brand rounded-xl p-4"
              onPress={() => router.push("/(worker)/earnings")}
            >
              <Ionicons
                name="wallet-outline"
                size={24}
                color={colors.success}
              />
              <Text className="text-brand font-semibold mt-2">
                My Earnings
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 min-w-[140] bg-orange-100 border-2 border-brand rounded-xl p-4"
              onPress={() => router.push("/(worker)/profile/certifications")}
            >
              <Ionicons
                name="document-text-outline"
                size={24}
                color={colors.warning}
              />
              <Text className="text-brand font-semibold mt-2">
                Certifications
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 min-w-[140] bg-purple-100 border-2 border-brand rounded-xl p-4"
              onPress={() => router.push("/(worker)/profile")}
            >
              <Ionicons
                name="person-outline"
                size={24}
                color={colors.brand.light}
              />
              <Text className="text-brand font-semibold mt-2">
                View Profile
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
