import React, { useEffect } from "react";
import { View, Text, ScrollView, Animated, Easing } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import { colors } from "../../../constants";
import { useBookingStore } from "../../../store/bookingStore";

export default function BookingSuccessScreen() {
  const router = useRouter();
  const selectedBooking = useBookingStore((s) => s.selectedBooking);
  const scaleAnim = React.useRef(new Animated.Value(0)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Scale animation for the checkmark icon
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Opacity animation for the content
    Animated.timing(opacityAnim, {
      toValue: 1,
      duration: 500,
      delay: 300,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim, opacityAnim]);

  const referenceNumber = selectedBooking?.id ?? "Pending";

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingVertical: 40,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {/* Success Icon with Animation */}
        <Animated.View
          style={{
            transform: [{ scale: scaleAnim }],
            marginBottom: 32,
          }}
        >
          <View className="w-40 h-40 bg-success/20 rounded-full items-center justify-center">
            <Ionicons
              name="checkmark-circle"
              size={100}
              color={colors.success}
            />
          </View>
        </Animated.View>

        {/* Main Content */}
        <Animated.View style={{ opacity: opacityAnim, width: "100%" }}>
          <Text className="text-text-primary text-3xl font-bold text-center mb-2">
            Booking Confirmed!
          </Text>

          <Text className="text-text-secondary text-center text-base mb-8">
            Your booking request has been submitted successfully.
          </Text>

          {/* Booking Details Card */}
          <View className="bg-green-50 rounded-2xl p-4 mb-6">
            <View className="flex-row items-center mb-3">
              <Ionicons name="checkmark" size={20} color={colors.success} />
              <Text className="text-success font-semibold text-sm ml-3">
                Request submitted
              </Text>
            </View>
            <View className="flex-row items-center mb-3">
              <Ionicons name="calendar" size={20} color={colors.success} />
              <Text className="text-success font-semibold text-sm ml-3">
                {selectedBooking?.date}
                {selectedBooking?.time ? ` at ${selectedBooking.time}` : ""}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Ionicons name="location" size={20} color={colors.success} />
              <Text className="text-success font-semibold text-sm ml-3 flex-1">
                {selectedBooking?.address || "Location set"}
              </Text>
            </View>
          </View>

          {/* Reference Number Card */}
          <View className="bg-card border border-accent rounded-2xl p-4 mb-8">
            <Text className="text-text-secondary text-xs mb-1">
              Booking Reference
            </Text>
            <Text className="text-text-primary font-bold text-lg mb-3">
              {referenceNumber}
            </Text>
            <View className="border-t border-divider pt-3">
              <Text className="text-text-secondary text-xs mb-1">Service</Text>
              <Text className="text-brand font-semibold">
                {selectedBooking?.category || selectedBooking?.service || "Service"}
              </Text>
            </View>
          </View>

          {/* Info Text */}
          <Text className="text-text-secondary text-center text-sm mb-8">
            A confirmation email has been sent to you. You&apos;ll receive an
            update once the worker accepts your booking.
          </Text>
        </Animated.View>

        {/* Buttons */}
        <View className="w-full gap-3">
          <OutlinedButton
            label="Track My Booking"
            onPress={() => {
              if (selectedBooking) {
                router.push(`/(client)/booking/${selectedBooking.id}`);
              } else {
                router.push("/(client)/booking");
              }
            }}
          />
          <PrimaryButton
            label="Go to Home"
            fullWidth
            onPress={() => router.replace("/(client)/home")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
