import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Alert, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import StepperVertical from "../../../../components/steppers/StepperVertical";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import DangerButton from "../../../../components/ui/DangerButton";
import PriceBreakdownCard from "../../../../components/ui/PriceBreakdown";
import { LoadingSkeleton } from "../../../../components/feedback/LoadingSkeleton";
import {
  useBookingStore,
  type Booking,
  type BookingState,
} from "../../../../store/bookingStore";
import { getBookingDetail } from "../../../../services/api";
import { calculatePriceBreakdown } from "../../../../utils/pricing";
import { isExactCategoryMatch } from "../../../../utils/categoryMapping";
import type { StatusType } from "../../../../components/ui/StatusBadge";
import { colors } from "../../../../constants";
import { workers } from "../../../../constants/dummyData";

// Backend BookingStatus enum -> store's friendly status values
const API_STATUS_MAP: Record<string, Booking["status"]> = {
  PENDING: "Pending",
  ACCEPTED: "Accepted",
  REJECTED: "Cancelled",
  IN_PROGRESS: "InProgress",
  QUOTE_SUBMITTED: "QuoteSubmitted",
  QUOTE_APPROVED: "QuoteApproved",
  DISPUTED: "Disputed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

type ApiBookingDetail = {
  id: string;
  worker: { id: string; fullName: string; phone?: string | null } | null;
  service: string;
  status: string;
  location: string;
  scheduledDate: string;
  scheduledTime: string | null;
  estimatedPrice: number;
  finalPrice: number | null;
  payment: {
    methodType: string;
    accountIdentifier: string | null;
    status: string;
    totalAmount: number;
  } | null;
  quote: {
    laborCost: number;
    materialsCost: number;
    notes: string | null;
    quotedAt: string | null;
  } | null;
  review: { rating: number; comment: string | null } | null;
};

function mapApiBookingDetail(d: ApiBookingDetail): Booking {
  return {
    id: d.id,
    service: d.service,
    worker: d.worker?.fullName ?? "Unassigned",
    workerId: d.worker?.id,
    workerPhone: d.worker?.phone ?? undefined,
    date: d.scheduledDate,
    time: d.scheduledTime ?? undefined,
    address: d.location,
    status: API_STATUS_MAP[d.status] ?? "Pending",
    amount: d.finalPrice ?? d.estimatedPrice,
    payment: d.payment
      ? {
          methodType: d.payment.methodType,
          accountIdentifier: d.payment.accountIdentifier ?? undefined,
          status: d.payment.status,
          totalAmount: d.payment.totalAmount,
        }
      : undefined,
    quote: d.quote
      ? {
          laborCost: d.quote.laborCost,
          materialsCost: d.quote.materialsCost,
          totalAmount: d.finalPrice ?? 0,
          notes: d.quote.notes ?? "",
          submittedAt: d.quote.quotedAt ?? d.scheduledDate,
        }
      : undefined,
    rating: d.review?.rating,
    reviewText: d.review?.comment ?? undefined,
  };
}

export default function BookingDetailScreen() {
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, updateBookingStatus, prefillFromBooking } =
    useBookingStore();
  const booking = bookings.find((b) => b.id === bookingId);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const data: ApiBookingDetail = await getBookingDetail(bookingId);
          if (cancelled) return;
          const mapped = mapApiBookingDetail(data);
          useBookingStore.setState((s) => ({
            bookings: [...s.bookings.filter((b) => b.id !== mapped.id), mapped],
          }));
        } catch (error) {
          console.error("Load booking detail error:", error);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [bookingId]),
  );

  if (loading && !booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Booking Details" showBack />
        <LoadingSkeleton type="booking" count={1} />
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Booking Details" showBack />
        <View className="flex-1 items-center justify-center">
          <Ionicons
            name="document-outline"
            size={48}
            color={colors.text.muted}
          />
          <Text className="text-text-secondary text-sm mt-2">
            Booking not found
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const priceBreakdown = calculatePriceBreakdown(booking.amount, 1, 0, 0);

  const statusColor =
    {
      Pending: colors.warning,
      Accepted: "#3B82F6",
      Active: colors.active,
      InProgress: colors.accent.DEFAULT,
      QuoteSubmitted: "#8B5CF6",
      QuoteApproved: "#0D9488",
      Disputed: "#F97316",
      Completed: colors.success,
      Cancelled: colors.error,
    }[booking.status] || colors.text.muted;

  const canCancel = booking.status === "Pending";
  const canTrack =
    booking.status === "Active" || booking.status === "InProgress";
  const canComplete =
    booking.status === "Active" || booking.status === "QuoteApproved";
  const isCompleted = booking.status === "Completed";
  const hasQuote = booking.status === "QuoteSubmitted" && booking.quote;
  const quoteActedOn =
    booking.status === "QuoteApproved" || booking.status === "Disputed";

  const steps = [
    { label: "Requested", timestamp: booking.date, status: "done" as const },
    {
      label: "Accepted",
      timestamp: "",
      status:
        booking.status === "Pending" ? ("pending" as const) : ("done" as const),
    },
    {
      label: "In Progress",
      timestamp: "",
      status:
        booking.status === "Active" || booking.status === "InProgress"
          ? ("active" as const)
          : booking.status === "QuoteSubmitted" ||
              booking.status === "QuoteApproved" ||
              booking.status === "Completed"
            ? ("done" as const)
            : ("pending" as const),
    },
    {
      label: "Completed",
      timestamp: "",
      status:
        booking.status === "Completed"
          ? ("done" as const)
          : ("pending" as const),
    },
  ];

  const workerName =
    workers.find((w) => w.id === booking.worker)?.name ?? booking.worker;

  const handleComplete = () => {
    updateBookingStatus(booking.id, "Completed");
    router.push({
      pathname: "/(client)/booking/post-service" as any,
      params: { bookingId: booking.id },
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Booking Details" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        {/* Status Row */}
        <View className="flex-row items-center gap-2 mb-4">
          <View
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <Text
            className="font-semibold text-sm"
            style={{ color: statusColor }}
          >
            {booking.status === "QuoteSubmitted"
              ? "Quote Submitted — Action Required"
              : booking.status === "QuoteApproved"
                ? "Quote Approved"
                : booking.status === "Disputed"
                  ? "Quote Disputed"
                  : booking.status === "InProgress"
                    ? "In Progress"
                    : booking.status}
          </Text>
          <Text className="text-text-secondary text-xs ml-auto">
            ID: {booking.id}
          </Text>
        </View>

        {/* Quote notification banner */}
        {hasQuote && (
          <Pressable
            className="bg-purple-50 border border-purple-200 rounded-2xl p-4 mb-4 flex-row items-center"
            onPress={() => router.push(`/(client)/booking/${bookingId}/quote`)}
          >
            <Ionicons name="document-text" size={24} color="#8B5CF6" />
            <View className="ml-3 flex-1">
              <Text className="font-bold text-sm" style={{ color: "#6D28D9" }}>
                Worker submitted a quote
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                ₱{booking.quote!.totalAmount.toFixed(2)} total · Tap to review
                and approve
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={colors.text.muted}
            />
          </Pressable>
        )}

        {/* Quote approved banner */}
        {booking.status === "QuoteApproved" && booking.quote && (
          <View className="bg-success/10 border border-success/30 rounded-2xl p-4 mb-4 flex-row items-center">
            <Ionicons
              name="checkmark-circle"
              size={24}
              color={colors.success}
            />
            <View className="ml-3 flex-1">
              <Text className="text-success font-bold text-sm">
                Quote approved
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                Agreed total: ₱{booking.quote.totalAmount.toFixed(2)}
              </Text>
            </View>
          </View>
        )}

        {/* Disputed banner */}
        {booking.status === "Disputed" && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4 flex-row items-center">
            <Ionicons name="alert-circle" size={24} color={colors.warning} />
            <View className="ml-3 flex-1">
              <Text className="text-warning font-bold text-sm">
                Quote disputed
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                Support will contact you within 24 hours.
              </Text>
            </View>
          </View>
        )}

        {/* Service Info */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-secondary text-xs mb-1">Service</Text>
          <Text className="text-text-primary font-bold text-lg">
            {booking.service}
          </Text>
        </View>

        {/* Worker Info */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-secondary text-xs mb-2">
            Assigned Worker
          </Text>
          <View className="flex-row items-center">
            <View className="w-12 h-12 rounded-full bg-accent/20 items-center justify-center">
              <Ionicons name="person" size={24} color={colors.accent.DEFAULT} />
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-brand font-semibold">{workerName}</Text>
              <Text className="text-text-secondary text-xs">Professional</Text>
            </View>
            <Pressable
              onPress={() => {
                if (!booking.workerId) {
                  Alert.alert("Unavailable", "This worker cannot be messaged yet.");
                  return;
                }
                router.push(`/(client)/inbox/chat/${booking.workerId}`);
              }}
              className="p-2 mr-1"
            >
              <Ionicons
                name="chatbubble-outline"
                size={22}
                color={colors.accent.DEFAULT}
              />
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
              className="p-2"
            >
              <Ionicons
                name="call-outline"
                size={22}
                color={colors.accent.DEFAULT}
              />
            </Pressable>
          </View>
        </View>

        {/* Date & Address */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <View className="flex-row items-center mb-2">
            <Ionicons name="calendar" size={16} color={colors.accent.DEFAULT} />
            <Text className="text-brand font-semibold ml-2">
              {new Date(booking.date).toLocaleDateString("en-PH", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </View>
          {booking.time && (
            <View className="flex-row items-center mb-2">
              <Ionicons name="time" size={16} color={colors.accent.DEFAULT} />
              <Text className="text-brand font-semibold ml-2">
                {booking.time}
              </Text>
            </View>
          )}
          {booking.address && (
            <View className="flex-row items-start">
              <Ionicons
                name="location"
                size={16}
                color={colors.accent.DEFAULT}
              />
              <Text className="text-brand font-semibold ml-2 flex-1">
                {booking.address}
              </Text>
            </View>
          )}
        </View>

        {/* Price Breakdown */}
        <View className="mb-3">
          <PriceBreakdownCard breakdown={priceBreakdown} detailed={true} />
        </View>

        {/* Payment Method */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-secondary text-xs mb-2">
            Payment Method
          </Text>
          <View className="flex-row items-center">
            <Ionicons
              name={
                booking.payment?.methodType === "CASH"
                  ? "wallet"
                  : booking.payment?.methodType === "MAYA"
                    ? "card"
                    : "phone-portrait"
              }
              size={20}
              color={colors.accent.DEFAULT}
            />
            <Text className="text-brand font-semibold ml-3">
              {booking.payment?.methodType ?? "Payment pending"}
            </Text>
          </View>
        </View>

        {/* Progress Stepper */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold mb-3">Booking Progress</Text>
          <StepperVertical steps={steps} />
        </View>

        {/* Rating (if completed) */}
        {isCompleted && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-secondary text-xs mb-2">
              Your Rating
            </Text>
            {booking.rating ? (
              <View>
                <View className="flex-row items-center mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Ionicons
                      key={star}
                      name={star <= booking.rating! ? "star" : "star-outline"}
                      size={20}
                      color={colors.accent.DEFAULT}
                    />
                  ))}
                </View>
                {booking.reviewText && (
                  <Text className="text-brand text-sm mt-1">
                    {`"${booking.reviewText}"`}
                  </Text>
                )}
              </View>
            ) : (
              <Text className="text-text-secondary text-sm">
                No review yet.
              </Text>
            )}
          </View>
        )}

        {/* Action Buttons */}
        <View className="gap-3 mt-2">
          {hasQuote && (
            <PrimaryButton
              label="Review & Approve Quote"
              fullWidth
              onPress={() =>
                router.push(`/(client)/booking/${bookingId}/quote`)
              }
            />
          )}
          {canComplete && (
            <PrimaryButton
              label="Mark as Complete"
              fullWidth
              onPress={handleComplete}
            />
          )}
          {canTrack && (
            <OutlinedButton
              label="Track Service"
              onPress={() =>
                router.push(`/(client)/booking/${bookingId}/track`)
              }
            />
          )}
          {isCompleted && !booking.rating && (
            <PrimaryButton
              label="Rate & Review"
              fullWidth
              onPress={() =>
                router.push({
                  pathname: "/(client)/profile/rate-review/[bookingId]",
                  params: { bookingId: booking.id },
                })
              }
            />
          )}
          {isCompleted && (
            <PrimaryButton
              label="Book Again"
              fullWidth
              onPress={() => {
                if (!isExactCategoryMatch(booking.service)) {
                  Alert.alert(
                    "Booking unavailable",
                    "This booking's service type couldn't be matched to a bookable category. Please try a different booking or contact support.",
                  );
                  return;
                }
                prefillFromBooking(booking);
                router.push("/(client)/booking/new/step-1");
              }}
            />
          )}
          {isCompleted && (
            <OutlinedButton
              label="View Receipt"
              onPress={() =>
                router.push(
                  `/(client)/profile/transactions/receipt/${booking.id}`,
                )
              }
            />
          )}
          {canCancel && (
            <DangerButton
              label="Cancel Booking"
              fullWidth
              onPress={() => router.push(`/(client)/booking/${bookingId}/cancel`)}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
