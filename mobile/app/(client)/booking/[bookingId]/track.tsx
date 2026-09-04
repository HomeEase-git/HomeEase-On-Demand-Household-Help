import React, { useCallback, useState } from "react";
import { View, Text, Image, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import AddressMap from "../../../../components/ui/AddressMap";
import { useBookingStore } from "../../../../store/bookingStore";
import * as api from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function TrackBookingScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const booking = useBookingStore((s) =>
    s.bookings.find((b) => b.id === bookingId),
  );
  const [location, setLocation] = useState<string | null>(
    booking?.address ?? null,
  );

  useFocusEffect(
    useCallback(() => {
      if (!bookingId) return;
      let cancelled = false;
      api
        .getBookingDetail(bookingId)
        .then((detail) => {
          if (!cancelled) setLocation(detail?.location ?? null);
        })
        .catch((error) => {
          console.error("Load booking location error:", error);
        });
      return () => {
        cancelled = true;
      };
    }, [bookingId]),
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

  // Mirrors the real BookingStatus lifecycle (store/bookingStore.ts) rather
  // than the old "Pending/Active/Completed, else = cancelled" shortcut —
  // that fallback was silently mislabeling every other real status
  // (InProgress, QuoteSubmitted, QuoteApproved, PendingCompletion, Disputed)
  // as "Booking cancelled".
  const steps = ["Booked", "Accepted", "In Progress", "Done"];

  const currentStepIndex = (() => {
    switch (booking.status) {
      case "Pending":
        return 0;
      case "Accepted":
      case "QuoteSubmitted":
      case "QuoteApproved":
        return 1;
      case "InProgress":
      case "PendingCompletion":
      case "AwaitingPayment":
      case "Disputed":
        return 2;
      case "Completed":
        return 3;
      default:
        return 0;
    }
  })();

  const statusLabel = (() => {
    switch (booking.status) {
      case "Pending":
        return "Waiting for worker to accept";
      case "Accepted":
        return "Worker accepted — getting ready";
      case "QuoteSubmitted":
        return "Worker sent a quote — awaiting your approval";
      case "QuoteApproved":
        return "Quote approved — worker will begin soon";
      case "InProgress":
        return "Worker is on the job";
      case "PendingCompletion":
        return "Job done — confirm and pay to finish";
      case "AwaitingPayment":
        return "Confirmed — complete your payment to finish";
      case "Disputed":
        return "This booking is under dispute";
      case "Completed":
        return "Service completed";
      case "Cancelled":
        return "Booking cancelled";
      default:
        return "Status: " + booking.status;
    }
  })();

  const statusColor =
    booking.status === "Completed"
      ? colors.success
      : booking.status === "Cancelled" || booking.status === "Disputed"
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

        <Text className="text-text-secondary text-sm font-semibold mb-2">
          Service Location
        </Text>
        <AddressMap address={location} height="min-h-[200]" />

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
          <View className="w-12 h-12 bg-card-dark rounded-full items-center justify-center mr-3 overflow-hidden">
            {booking.workerAvatar ? (
              <Image
                source={{ uri: booking.workerAvatar }}
                style={{ width: 48, height: 48 }}
                resizeMode="cover"
              />
            ) : (
              <Ionicons name="person-circle" size={40} color={colors.white} />
            )}
          </View>
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="text-text-primary font-bold">{booking.worker}</Text>
              {booking.workerVerified && (
                <Ionicons
                  name="checkmark-circle"
                  size={14}
                  color={colors.success}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
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
                alertModal.info("Unavailable", "This worker cannot be messaged yet.");
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
                alertModal.info("No phone number", "This worker has no phone number on file.");
                return;
              }
              Linking.openURL(`tel:${booking.workerPhone}`).catch(() =>
                alertModal.error("Error", "Could not open the phone dialer."),
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
