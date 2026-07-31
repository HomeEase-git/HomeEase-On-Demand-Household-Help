import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StarRating from "../../../../components/ui/StarRating";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import InputField from "../../../../components/ui/InputField";
import GenericSuccessModal from "../../../../components/modals/GenericSuccessModal";
import { useBookingStore } from "../../../../store/bookingStore";
import { submitReview as apiSubmitReview } from "../../../../services/api";
import { isExactCategoryMatch } from "../../../../utils/categoryMapping";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

export default function RateBookingScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const booking = useBookingStore((s) =>
    s.bookings.find((b) => b.id === bookingId),
  );
  const submitReview = useBookingStore((s) => s.submitReview);
  const prefillFromBooking = useBookingStore((s) => s.prefillFromBooking);

  const [rating, setRating] = useState(booking?.rating ?? 0);
  const [review, setReview] = useState(booking?.reviewText ?? "");
  const [successVisible, setSuccessVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const labels = ["Terrible", "Bad", "Okay", "Good", "Excellent"];

  const handleSubmit = async () => {
    if (!booking) {
      alertModal.error("Error", "Booking not found");
      return;
    }
    if (rating < 1) {
      alertModal.error("Error", "Please select a rating");
      return;
    }
    setLoading(true);
    try {
      await apiSubmitReview(booking.id, rating, review.trim());
      submitReview(booking.id, rating, review.trim());
      setSuccessVisible(true);
    } catch (error) {
      console.error("Submit review error:", error);
      alertModal.error("Error", "Failed to submit review. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBookAgain = () => {
    if (!booking) {
      alertModal.error("Error", "Booking not found");
      return;
    }

    if (!isExactCategoryMatch(booking.category ?? booking.service)) {
      alertModal.warning(
        "Booking unavailable",
        "This booking's service type couldn't be matched to a bookable category. Please try a different booking or contact support.",
      );
      return;
    }

    prefillFromBooking(booking);
    router.push("/(client)/booking/new/step-1");
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Rate & Review" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-card rounded-2xl p-4 mb-4 flex-row items-center">
          <View className="w-12 h-12 bg-card-light rounded-full items-center justify-center mr-3">
            <Text className="text-primary text-lg">👤</Text>
          </View>
          <View>
            <Text className="text-text-primary font-bold">
              {booking?.worker ?? "Worker"}
            </Text>
            <Text className="text-text-secondary text-sm">
              {booking?.service ?? "Service"}
            </Text>
          </View>
        </View>

        <Text className="text-text-secondary mb-2">
          How was your experience?
        </Text>
        <View className="flex-row items-center mb-2">
          <StarRating
            rating={rating}
            size={32}
            interactive
            onRate={setRating}
          />
        </View>
        <Text className="text-text-muted text-sm mb-4">
          {rating > 0 ? labels[rating - 1] : "Tap to rate"}
        </Text>

        <InputField
          label="Your review"
          value={review}
          onChangeText={setReview}
          placeholder="Share your experience..."
          multiline
        />

        <View className="mt-6 gap-3">
          <PrimaryButton
            label="Submit Review"
            fullWidth
            loading={loading}
            onPress={handleSubmit}
          />
          <OutlinedButton label="Book Again" onPress={handleBookAgain} />
        </View>
      </ScrollView>
      <GenericSuccessModal
        visible={successVisible}
        title="Review submitted!"
        onClose={() => {
          setSuccessVisible(false);
          router.replace(`/(client)/booking/${bookingId}`);
        }}
      />
    </SafeAreaView>
  );
}
