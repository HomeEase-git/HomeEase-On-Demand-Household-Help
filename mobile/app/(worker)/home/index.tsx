import React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import SectionHeader from "../../../components/ui/SectionHeader";
import RequestCard from "../../../components/cards/RequestCard";
import NotificationBadge from "../../../components/ui/NotificationBadge";
import { useWorkerStore } from "../../../store/workerStore";
import { useAuthStore } from "../../../store/authStore";
import { useNotificationStore } from "../../../store/notificationStore";
import { colors } from "../../../constants";

export default function WorkerHomeScreen() {
  const router = useRouter();
  const available = useWorkerStore((s) => s.available);
  const toggleAvailability = useWorkerStore((s) => s.toggleAvailability);
  const jobRequests = useWorkerStore((s) => s.jobRequests);
  const user = useAuthStore((s) => s.user);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  const firstName = user?.name?.split(" ")[0] ?? "Worker";
  const pending = jobRequests.filter((r) => r.status === "Pending");
  const todayCount = jobRequests.length;
  const todayEarnings = jobRequests
    .filter((r) => r.status === "Completed")
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <SafeAreaView className="flex-1 bg-primary-white" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        stickyHeaderIndices={[0]}
      >
        <View className="flex-row items-center justify-between px-4 pt-2 pb-2 bg-primary-white z-10">
          <Text className="text-primary text-xl font-bold">HomeEase</Text>
          <Pressable
            className="p-2"
            onPress={() => router.push("/(worker)/inbox")}
          >
            <Ionicons
              name="notifications-outline"
              size={24}
              color={colors.primary.dark}
            />
            <NotificationBadge count={unreadCount} />
          </Pressable>
        </View>

        <View className="bg-card rounded-2xl p-5 mx-4 mt-4">
          <Text className="text-primary font-bold text-xl">
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
          <Text className="text-primary font-bold flex-1">
            I&apos;m {available ? "Available" : "Unavailable"}
          </Text>
          <Pressable
            className={`w-12 h-7 rounded-full ${
              available ? "bg-accent" : "bg-card-dark"
            }`}
            onPress={toggleAvailability}
          >
            <View
              className={`w-5 h-5 rounded-full bg-primary-white mt-1 ${
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
            <Text className="text-accent font-bold text-2xl">{todayCount}</Text>
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
              .map((req) => (
                <RequestCard
                  key={req.id}
                  request={req}
                  onPress={() => router.push(`/(worker)/requests/${req.id}`)}
                />
              ))
          )}
        </View>

        <View className="mx-4 mt-4">
          <SectionHeader title="Quick Actions" />
          <View className="flex-row flex-wrap gap-3 mt-2">
            <Pressable
              className="flex-1 min-w-[140] bg-primary/25 border-2 border-primary rounded-xl p-4"
              onPress={() => router.push("/(worker)/profile/availability")}
            >
              <Ionicons
                name="calendar-outline"
                size={24}
                color={colors.primary.DEFAULT}
              />
              <Text className="text-primary font-semibold mt-2">
                Set Availability
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 min-w-[140] bg-green-100 border-2 border-primary rounded-xl p-4"
              onPress={() => router.push("/(worker)/earnings")}
            >
              <Ionicons
                name="wallet-outline"
                size={24}
                color={colors.success}
              />
              <Text className="text-primary font-semibold mt-2">
                My Earnings
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 min-w-[140] bg-orange-100 border-2 border-primary rounded-xl p-4"
              onPress={() => router.push("/(worker)/profile/certifications")}
            >
              <Ionicons
                name="document-text-outline"
                size={24}
                color={colors.warning}
              />
              <Text className="text-primary font-semibold mt-2">
                Certifications
              </Text>
            </Pressable>
            <Pressable
              className="flex-1 min-w-[140] bg-purple-100 border-2 border-primary rounded-xl p-4"
              onPress={() => router.push("/(worker)/profile")}
            >
              <Ionicons
                name="person-outline"
                size={24}
                color={colors.primary.light}
              />
              <Text className="text-primary font-semibold mt-2">
                View Profile
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
