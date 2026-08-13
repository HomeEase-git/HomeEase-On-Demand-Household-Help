import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Image, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StarRating from "../../../../components/ui/StarRating";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import InputField from "../../../../components/ui/InputField";
import GenericSuccessModal from "../../../../components/modals/GenericSuccessModal";
import { LoadingSkeleton } from "../../../../components/feedback/LoadingSkeleton";
import { EmptyState } from "../../../../components/feedback/EmptyState";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { colors } from "../../../../constants";
import { useBookingStore, API_STATUS_MAP, type Booking } from "../../../../store/bookingStore";
import { submitReview as apiSubmitReview, getBookingDetail, uploadReviewPhoto } from "../../../../services/api";
import { isExactCategoryMatch } from "../../../../utils/categoryMapping";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const MAX_REVIEW_PHOTOS = 5;

// Matches the shape of GET /bookings/:id, the same endpoint
// [bookingId]/index.tsx uses — this screen also needs to hydrate the store
// when opened directly (e.g. deep link) without that screen loading first.
function mapDetailToBooking(d: any): Booking {
  return {
    id: d.id,
    service: d.service,
    category: d.category ?? undefined,
    worker: d.worker?.fullName ?? "Unassigned",
    workerId: d.worker?.id,
    workerPhone: d.worker?.phone ?? undefined,
    workerAvatar: d.worker?.avatar ?? undefined,
    workerVerified: d.worker?.verified ?? undefined,
    date: d.scheduledDate,
    time: d.scheduledTime ?? undefined,
    address: d.location,
    status: API_STATUS_MAP[d.status] ?? "Pending",
    amount: d.finalPrice ?? d.estimatedPrice,
    completionPhotoUrl: d.completionPhotoUrl ?? undefined,
    rating: d.review?.rating,
    reviewText: d.review?.comment ?? undefined,
  };
}

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
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoSheetRef = useRef<BottomSheetHandle | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingBooking, setCheckingBooking] = useState(!booking);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (booking || !bookingId) return;
    let cancelled = false;
    (async () => {
      try {
        const detail = await getBookingDetail(bookingId);
        if (cancelled) return;
        const mapped = mapDetailToBooking(detail);
        useBookingStore.setState((s) => ({
          bookings: [...s.bookings.filter((b) => b.id !== mapped.id), mapped],
        }));
        setRating(mapped.rating ?? 0);
        setReview(mapped.reviewText ?? "");
      } catch (error) {
        console.error("Load booking for review error:", error);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setCheckingBooking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const labels = ["Terrible", "Bad", "Okay", "Good", "Excellent"];

  const handlePickPhoto = async (uri: string) => {
    if (!booking || photos.length >= MAX_REVIEW_PHOTOS) return;
    setUploadingPhoto(true);
    try {
      const { url } = await uploadReviewPhoto(booking.id, uri);
      setPhotos((prev) => [...prev, url]);
    } catch {
      alertModal.error("Upload failed", "Could not upload that photo. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = (url: string) => {
    setPhotos((prev) => prev.filter((u) => u !== url));
  };

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
      await apiSubmitReview(booking.id, rating, review.trim(), photos);
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

  if (checkingBooking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Rate & Review" showBack />
        <LoadingSkeleton type="booking" count={1} />
      </SafeAreaView>
    );
  }

  if (notFound || !booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Rate & Review" showBack />
        <EmptyState title="Booking not found" subtitle="This booking couldn't be loaded." />
      </SafeAreaView>
    );
  }

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

        <View className="flex-row flex-wrap gap-2 mt-3">
          {photos.map((url) => (
            <View key={url} className="relative">
              <Image source={{ uri: url }} className="w-20 h-20 rounded-xl" />
              <Pressable
                className="absolute -top-1.5 -right-1.5 bg-black/70 rounded-full w-5 h-5 items-center justify-center"
                onPress={() => handleRemovePhoto(url)}
              >
                <Ionicons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
          {photos.length < MAX_REVIEW_PHOTOS && (
            <Pressable
              className="w-20 h-20 rounded-xl border border-dashed items-center justify-center"
              style={{ borderColor: colors.divider }}
              onPress={() => photoSheetRef.current?.expand()}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? (
                <ActivityIndicator size="small" />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={20} color={colors.text.muted} />
                  <Text className="text-text-secondary text-[10px] mt-1">Add photo</Text>
                </>
              )}
            </Pressable>
          )}
        </View>

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
      <ImageSourcePickerBottomSheet innerRef={photoSheetRef} onSelect={handlePickPhoto} />
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
