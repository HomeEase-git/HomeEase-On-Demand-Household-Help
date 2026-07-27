import React from "react";
import { View, Text, Pressable, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import { useBookingStore } from "../../../../store/bookingStore";
import { colors } from "../../../../constants";

export default function TrackBookingScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const booking = useBookingStore((s) =>
    s.bookings.find((b) => b.id === bookingId),
  );

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Track Service" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Booking not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const steps = ["Booked", "Accepted", "On the Way", "In Progress", "Done"];

  const currentStepIndex =
    booking.status === "Pending"
      ? 0
      : booking.status === "Active"
        ? 2
        : booking.status === "Completed"
          ? 4
          : 0;

  const statusLabel =
    booking.status === "Pending"
      ? "Waiting for worker to accept"
      : booking.status === "Active"
        ? "Worker is on the way"
        : booking.status === "Completed"
          ? "Service completed"
          : "Booking cancelled";

  const statusColor =
    booking.status === "Completed"
      ? colors.success
      : booking.status === "Cancelled"
        ? colors.error
        : colors.warning;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Track Service" showBack />
      <View className="px-4 mt-2">
        <View className="flex-row justify-between mb-6">
          {steps.map((label, i) => (
            <View key={label} className="items-center flex-1">
              <View
                className={`w-8 h-8 rounded-full items-center justify-center ${
                  i <= currentStepIndex ? "bg-accent" : "bg-card-light"
                }`}
              >
                {i < currentStepIndex ? (
                  <Ionicons name="checkmark" size={16} color={colors.white} />
                ) : (
                  <Text
                    className={`text-sm font-bold ${
                      i <= currentStepIndex
                        ? "text-white"
                        : "text-text-secondary"
                    }`}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                className={`text-xs mt-1 text-center ${
                  i === currentStepIndex
                    ? "text-accent font-semibold"
                    : "text-text-muted"
                }`}
                numberOfLines={2}
              >
                {label}
              </Text>
            </View>
          ))}
        </View>

        <View className="flex-1 bg-card-dark rounded-2xl items-center justify-center min-h-[200]">
          <Ionicons name="map" size={60} color={colors.accent.DEFAULT} />
          <Text className="text-text-secondary mt-2">Live Tracking</Text>
          <Text className="text-text-muted text-xs mt-1">
            Real-time map available after backend integration
          </Text>
        </View>

        <View
          className="rounded-full py-2 px-4 self-center mt-4"
          style={{ backgroundColor: `${statusColor}20` }}
        >
          <Text
            className="font-semibold text-sm"
            style={{ color: statusColor }}
          >
            {statusLabel}
          </Text>
        </View>

        <View className="bg-card rounded-2xl p-4 mt-6 flex-row items-center">
          <View className="w-12 h-12 bg-card-dark rounded-full items-center justify-center mr-3">
            <Ionicons name="person-circle" size={40} color={colors.white} />
          </View>
          <View className="flex-1">
            <Text className="text-text-primary font-bold">{booking.worker}</Text>
            <Text
              className="text-sm font-semibold"
              style={{ color: statusColor }}
            >
              {booking.status}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              if (!booking.workerId) {
                Alert.alert("Unavailable", "This worker cannot be messaged yet.");
                return;
              }
              router.push(`/(client)/inbox/chat/${booking.workerId}`);
            }}
            className="bg-accent rounded-full p-2 mr-2"
          >
            <Ionicons name="chatbubble" size={20} color={colors.white} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (!booking.workerPhone) {
                Alert.alert("No phone number", "This worker has no phone number on file.");
                return;
              }
              Linking.openURL(`tel:${booking.workerPhone}`).catch(() =>
                Alert.alert("Error", "Could not open the phone dialer."),
              );
            }}
            className="bg-accent rounded-full p-2"
          >
            <Ionicons name="call" size={20} color={colors.white} />
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}
