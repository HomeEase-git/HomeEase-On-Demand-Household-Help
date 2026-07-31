import React, { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenHeader } from "../../../components/ui/ScreenHeader";
import { PrimaryButton } from "../../../components/ui/PrimaryButton";
import { InputField } from "../../../components/ui/InputField";
import { useBookingStore } from "../../../store/bookingStore";
import { useToastContext } from "../../../contexts/ToastContext";
import { colors } from "../../../constants";

interface TimelineEvent {
  status: "scheduled" | "in-progress" | "completed";
  label: string;
  time: string;
  completed: boolean;
}

const TIMELINE_EVENTS: TimelineEvent[] = [
  {
    status: "scheduled",
    label: "Service Scheduled",
    time: "9:00 AM",
    completed: true,
  },
  {
    status: "in-progress",
    label: "Worker Arrived",
    time: "9:15 AM",
    completed: true,
  },
  {
    status: "completed",
    label: "Service Complete",
    time: "11:30 AM",
    completed: true,
  },
];

export default function PostServiceScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, submitReview } = useBookingStore();
  const toast = useToastContext();

  const booking = bookings.find((b) => b.id === bookingId);

  const [rating, setRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [customTip, setCustomTip] = useState("");
  const [loading, setLoading] = useState(false);

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Service Complete" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Booking not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSubmitReview = async () => {
    if (rating === 0) {
      toast.error("Please select a rating");
      return;
    }

    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      submitReview(booking.id, rating, reviewText);
      toast.success("Thank you for your review!");

      setTimeout(() => {
        router.replace("/(client)/booking");
      }, 1500);
    } catch {
      toast.error("Failed to submit review");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipReview = () => {
    router.replace("/(client)/booking");
  };

  const handleTip = () => {
    const finalTip = customTip ? parseFloat(customTip) || 0 : tipAmount;
    if (finalTip > 0) {
      toast.success(`Tip of ₱${finalTip} added successfully!`);
    }
    setTipAmount(0);
    setCustomTip("");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Service Complete" showBack />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
        className="flex-1"
      >
        {/* Success Header */}
        <View className="items-center mb-6">
          <View className="w-16 h-16 rounded-full bg-success/20 items-center justify-center mb-3">
            <Ionicons
              name="checkmark-circle"
              size={40}
              color={colors.success}
            />
          </View>
          <Text className="text-text-primary font-bold text-xl text-center">
            Service Completed
          </Text>
          <Text className="text-text-secondary text-sm mt-2 text-center">
            Thank you for choosing {booking.worker}
          </Text>
        </View>

        {/* Timeline */}
        <View className="bg-card rounded-2xl p-4 mb-4">
          <Text className="text-text-primary font-bold mb-4">Service Timeline</Text>
          {TIMELINE_EVENTS.map((event, index) => (
            <View key={event.status}>
              <View className="flex-row">
                <View className="items-center mr-4">
                  <View
                    className={`w-4 h-4 rounded-full ${
                      event.completed ? "bg-success" : "bg-text-muted"
                    }`}
                  />
                  {index < TIMELINE_EVENTS.length - 1 && (
                    <View
                      className="w-0.5 h-8 bg-text-muted"
                      style={{ marginVertical: 4 }}
                    />
                  )}
                </View>
                <View className="flex-1 pb-4">
                  <Text className="text-brand font-semibold">
                    {event.label}
                  </Text>
                  <Text className="text-text-secondary text-xs mt-1">
                    {event.time}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Rating Section */}
        <View className="bg-card rounded-2xl p-4 mb-4">
          <Text className="text-text-primary font-bold mb-3">
            Rate Your Experience
          </Text>
          <View className="flex-row justify-center gap-3 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable
                key={star}
                onPress={() => setRating(star)}
                className="p-1"
              >
                <Ionicons
                  name={star <= rating ? "star" : "star-outline"}
                  size={32}
                  color={
                    star <= rating ? colors.accent.DEFAULT : colors.text.muted
                  }
                />
              </Pressable>
            ))}
          </View>
          {rating > 0 && (
            <Text className="text-text-secondary text-xs text-center">
              {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][rating]}
            </Text>
          )}
        </View>

        {/* Review Text */}
        {rating > 0 && (
          <View className="mb-4">
            <InputField
              label="Add a comment (optional)"
              value={reviewText}
              onChangeText={setReviewText}
              placeholder="Share your feedback..."
              multiline
            />
          </View>
        )}

        {/* Tip Section */}
        <View className="bg-accent/10 rounded-2xl p-4 mb-4">
          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <Ionicons name="gift" size={20} color={colors.accent.DEFAULT} />
              <Text className="text-text-primary font-bold">Add a Tip</Text>
            </View>
            <Text className="text-text-secondary text-xs">Optional</Text>
          </View>

          <View className="flex-row gap-2 flex-wrap mb-3">
            {[0, 50, 100, 200].map((amount) => (
              <Pressable
                key={amount}
                className={`px-4 py-2 rounded-lg ${
                  tipAmount === amount && !customTip ? "bg-accent" : "bg-white"
                }`}
                onPress={() => {
                  setTipAmount(amount);
                  setCustomTip("");
                }}
              >
                <Text
                  className={`font-semibold text-sm ${
                    tipAmount === amount && !customTip
                      ? "text-white"
                      : "text-text-secondary"
                  }`}
                >
                  {amount === 0 ? "No Tip" : `₱${amount}`}
                </Text>
              </Pressable>
            ))}
          </View>

          <InputField
            label=""
            value={customTip}
            onChangeText={(val) => {
              setCustomTip(val);
              setTipAmount(0);
            }}
            placeholder="Enter custom tip amount"
            keyboardType="numeric"
          />

          {(tipAmount > 0 || customTip) && (
            <Pressable
              className="border border-accent rounded-xl py-3 items-center justify-center mt-2"
              onPress={handleTip}
            >
              <Text className="text-accent font-semibold">
                Add Tip ₱{customTip || tipAmount}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Action Buttons */}
        <View className="gap-3">
          <PrimaryButton
            label={rating > 0 ? "Submit Review" : "Skip Review"}
            fullWidth
            loading={loading}
            onPress={rating > 0 ? handleSubmitReview : handleSkipReview}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
