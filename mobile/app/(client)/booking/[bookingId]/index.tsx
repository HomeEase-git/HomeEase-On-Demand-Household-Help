import React, { useState } from "react";
import { View, Text, Image, ScrollView, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import StepperVertical from "../../../../components/steppers/StepperVertical";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import DangerButton from "../../../../components/ui/DangerButton";
import PriceBreakdownCard from "../../../../components/ui/PriceBreakdown";
import { LoadingSkeleton } from "../../../../components/feedback/LoadingSkeleton";
import XenditCheckoutModal from "../../../../components/payment/XenditCheckoutModal";
import {
  useBookingStore,
  API_STATUS_MAP,
  type Booking,
  type BookingState,
} from "../../../../store/bookingStore";
import {
  getBookingDetail,
  confirmBookingCompletion,
  createXenditCheckout,
  getTransactionDetail,
} from "../../../../services/api";
import type { StatusType } from "../../../../components/ui/StatusBadge";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import type { ConditionType, RoomType, TimeSlot, UrgencyLevel } from "../../../../types/booking4step.types";

type ApiBookingDetail = {
  id: string;
  worker: { id: string; fullName: string; phone?: string | null; avatar?: string | null; verified?: boolean } | null;
  service: string;
  category?: string;
  status: string;
  description?: string | null;
  location: string;
  city?: string | null;
  clientLat?: number | null;
  clientLng?: number | null;
  timeSlot?: TimeSlot | null;
  urgencyLevel?: UrgencyLevel | null;
  condition?: ConditionType | null;
  rooms?: RoomType[];
  scopeAnswers?: Record<string, string | string[]> | null;
  scheduledDate: string;
  scheduledTime: string | null;
  estimatedPrice: number;
  finalPrice: number | null;
  completionPhotoUrl?: string | null;
  // Settled at booking time — used to auto-process payment after completion
  // is confirmed, without asking the client to pick a method again.
  paymentMethodType?: string | null;
  paymentAccountIdentifier?: string | null;
  payment: {
    methodType: string;
    accountIdentifier: string | null;
    status: string;
    totalAmount: number;
    subtotal?: number;
    tip?: number;
  } | null;
  addOns?: { id: string; name: string; price: number }[];
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
    payment: d.payment
      ? {
          methodType: d.payment.methodType,
          accountIdentifier: d.payment.accountIdentifier ?? undefined,
          status: d.payment.status,
          totalAmount: d.payment.totalAmount,
        }
      : d.paymentMethodType
        ? {
            methodType: d.paymentMethodType,
            accountIdentifier: d.paymentAccountIdentifier ?? undefined,
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
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, prefillFromBooking, prefillFromDeclinedBooking } = useBookingStore();
  const booking = bookings.find((b) => b.id === bookingId);
  // The shared store's Booking type only keeps payment.totalAmount (used by
  // many other screens) — the real subtotal/addOns/tip breakdown is kept
  // separately here so the price breakdown card can render the actual
  // backend-persisted charge instead of recomputing an invented one.
  const [rawDetail, setRawDetail] = useState<ApiBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          const data: ApiBookingDetail = await getBookingDetail(bookingId);
          if (cancelled) return;
          const mapped = mapApiBookingDetail(data);
          setRawDetail(data);
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

  // Real, backend-persisted values only — payment.subtotal/tip/totalAmount
  // are what Xendit actually charged; fall back to the booking amount for
  // the rare case a Payment row doesn't exist yet.
  const priceBreakdown = {
    subtotal: rawDetail?.payment?.subtotal ?? booking.amount,
    addOns: rawDetail?.addOns?.map((a) => ({ name: a.name, price: a.price })) ?? [],
    tip: rawDetail?.payment?.tip ?? 0,
    total: booking.payment?.totalAmount ?? booking.amount,
  };

  const statusCaption: Partial<Record<Booking["status"], string>> = {
    QuoteSubmitted: "Action required",
    Disputed: "Under review",
    PendingCompletion: "Action required",
    AwaitingPayment: "Payment required",
  };

  const canCancel = booking.status === "Pending";
  const canTrack =
    booking.status === "Accepted" || booking.status === "InProgress";
  const isCompleted = booking.status === "Completed";
  const isPendingCompletion = booking.status === "PendingCompletion";
  const isAwaitingPayment = booking.status === "AwaitingPayment";
  const hasQuote = booking.status === "QuoteSubmitted" && booking.quote;
  // Distinct from a client-initiated cancel — both collapse to the same
  // "Cancelled" bucket in booking.status (see API_STATUS_MAP), so this
  // checks the raw backend status instead, to only offer "Find Another
  // Pro" when a worker actually declined the request.
  const isDeclined = rawDetail?.status === "REJECTED";

  const handleFindAnotherPro = () => {
    if (!rawDetail) return;
    prefillFromDeclinedBooking(rawDetail);
    router.push("/(client)/booking/new/step-1");
  };

  // Payment is taken after completion and is locked to the method the client
  // chose at booking time — no picker at the pay step.
  const bookingMethod = (
    rawDetail?.paymentMethodType ??
    booking.payment?.methodType ??
    "CASH"
  ).toUpperCase();
  const isCashBooking = bookingMethod === "CASH";
  const finalTotal =
    rawDetail?.payment?.totalAmount ??
    booking.payment?.totalAmount ??
    booking.amount;

  // Polls the payment detail until the Xendit webhook has resolved it to
  // COMPLETED/FAILED (it processes within a second or two of the redirect in
  // test mode), or gives up after ~15s so the UI doesn't hang forever.
  const waitForPaymentOutcome = async (targetBookingId: string) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const detail = await getTransactionDetail(targetBookingId);
      if (detail?.status === "Completed" || detail?.status === "Failed") {
        return detail;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return null;
  };

  const openCheckout = (url: string) => {
    setCheckoutUrl(url);
    setCheckoutVisible(true);
  };

  // "Resume Payment" on an AWAITING_PAYMENT booking — re-opens the hosted
  // Xendit invoice (server reuses the live one or mints a fresh one).
  const handleResumePayment = async () => {
    if (processingPayment) return;
    setProcessingPayment(true);
    try {
      const { checkoutUrl: url } = await createXenditCheckout(booking.id);
      openCheckout(url);
    } catch (error) {
      console.error("Resume payment error:", error);
      setProcessingPayment(false);
      alertModal.error(
        "Payment failed",
        "We couldn't start the checkout. Please try again from this screen.",
      );
    }
  };

  const handleCheckoutSuccess = async () => {
    setCheckoutVisible(false);
    setCheckoutUrl(null);
    try {
      const detail = await waitForPaymentOutcome(booking.id);
      if (detail?.status === "Completed") {
        useBookingStore.setState((s) => ({
          bookings: s.bookings.map((b) =>
            b.id === booking.id
              ? {
                  ...b,
                  status: "Completed" as const,
                  payment: {
                    methodType: detail.method ?? b.payment?.methodType ?? "GCASH",
                    status: "COMPLETED",
                    totalAmount: detail.amount ?? b.payment?.totalAmount,
                  },
                }
              : b,
          ),
        }));
        alertModal.success(
          "Payment successful",
          "The worker has been paid. Thank you!",
        );
      } else if (detail?.status === "Failed") {
        alertModal.error(
          "Payment failed",
          detail.failureMessage || "The payment was declined. You can try again from this screen.",
        );
      } else {
        alertModal.info(
          "Still processing",
          "We're still confirming your payment. Check back on this screen in a moment.",
        );
      }
    } catch (error) {
      console.error("Confirm Xendit payment error:", error);
      alertModal.error(
        "Error",
        "We couldn't confirm your payment status. Please check back shortly.",
      );
    } finally {
      setProcessingPayment(false);
    }
  };

  const handleCheckoutFailed = () => {
    setCheckoutVisible(false);
    setCheckoutUrl(null);
    setProcessingPayment(false);
    alertModal.error(
      "Payment failed",
      "The payment was not completed. You can try again from this screen.",
    );
  };

  const handleCheckoutCancel = () => {
    setCheckoutVisible(false);
    setCheckoutUrl(null);
    setProcessingPayment(false);
  };

  // "Confirm & Pay" (online) / "Confirm Cash Payment" (cash). Cash finalizes
  // immediately; GCash/Maya returns a Xendit checkout URL to open.
  const handleConfirmCompletion = async () => {
    if (confirmingCompletion) return;
    setConfirmingCompletion(true);
    try {
      const result = await confirmBookingCompletion(booking.id);

      if (result.status === "COMPLETED") {
        useBookingStore.setState((s) => ({
          bookings: s.bookings.map((b) =>
            b.id === booking.id ? { ...b, status: "Completed" as const } : b,
          ),
        }));
        alertModal.success(
          "Payment recorded",
          "Thanks! This job is now complete.",
        );
      } else {
        // AWAITING_PAYMENT — open the hosted Xendit checkout.
        useBookingStore.setState((s) => ({
          bookings: s.bookings.map((b) =>
            b.id === booking.id
              ? { ...b, status: "AwaitingPayment" as const }
              : b,
          ),
        }));
        setProcessingPayment(true);
        openCheckout(result.checkoutUrl);
      }
    } catch (error) {
      console.error("Confirm completion error:", error);
      alertModal.error(
        "Error",
        "Failed to confirm completion. Please try again.",
      );
    } finally {
      setConfirmingCompletion(false);
    }
  };

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
        booking.status === "InProgress"
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

  const workerName = booking.worker;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Booking Details" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      >
        {/* Status Row */}
        <View className="flex-row items-center gap-2 mb-4">
          <StatusBadge status={booking.status} />
          {statusCaption[booking.status] ? (
            <Text className="text-text-secondary text-xs font-semibold">
              {statusCaption[booking.status]}
            </Text>
          ) : null}
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
              <Text className="font-bold text-sm text-purple-800">
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

        {/* Declined banner */}
        {isDeclined && (
          <View className="bg-error/10 border border-error/30 rounded-2xl p-4 mb-4">
            <View className="flex-row items-center">
              <Ionicons name="close-circle" size={24} color={colors.error} />
              <View className="ml-3 flex-1">
                <Text className="text-error font-bold text-sm">
                  This pro declined the request
                </Text>
                <Text className="text-text-secondary text-xs mt-0.5">
                  Your scope, address, and schedule are unaffected — pick a different pro to continue.
                </Text>
              </View>
            </View>
            <View className="mt-3">
              <PrimaryButton label="Find Another Pro" fullWidth onPress={handleFindAnotherPro} />
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
            <View className="w-12 h-12 rounded-full bg-accent/20 items-center justify-center overflow-hidden">
              {booking.workerAvatar ? (
                <Image
                  source={{ uri: booking.workerAvatar }}
                  style={{ width: 48, height: 48 }}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="person" size={24} color={colors.accent.DEFAULT} />
              )}
            </View>
            <View className="ml-3 flex-1">
              <View className="flex-row items-center">
                <Text className="text-primary font-semibold">{workerName}</Text>
                {booking.workerVerified && (
                  <Ionicons
                    name="checkmark-circle"
                    size={14}
                    color={colors.success}
                    style={{ marginLeft: 4 }}
                  />
                )}
              </View>
              <Text className="text-text-secondary text-xs">
                {booking.workerVerified ? "Verified Professional" : "Professional"}
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
                  alertModal.info("No phone number", "This worker has no phone number on file.");
                  return;
                }
                Linking.openURL(`tel:${booking.workerPhone}`).catch(() =>
                  alertModal.error("Error", "Could not open the phone dialer."),
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
            <Text className="text-primary font-semibold ml-2">
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
              <Text className="text-primary font-semibold ml-2">
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
              <Text className="text-primary font-semibold ml-2 flex-1">
                {booking.address}
              </Text>
            </View>
          )}
        </View>

        {/* Price Breakdown */}
        <View className="mb-3">
          <PriceBreakdownCard
            subtotal={priceBreakdown.subtotal}
            addOns={priceBreakdown.addOns}
            tip={priceBreakdown.tip}
            total={priceBreakdown.total}
            detailed={true}
          />
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
            <Text className="text-primary font-semibold ml-3">
              {booking.payment?.methodType ?? "Payment pending"}
            </Text>
          </View>
        </View>

        {/* Completion photo — worker's proof of finished work */}
        {booking.completionPhotoUrl && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold mb-2">
              {isPendingCompletion ? "Worker Submitted Completed Work" : "Completion Photo"}
            </Text>
            <Image
              source={{ uri: booking.completionPhotoUrl }}
              style={{ width: "100%", height: 220, borderRadius: 16 }}
              resizeMode="cover"
            />
            {isPendingCompletion && (
              <Text className="text-text-secondary text-xs mt-2">
                Review the photo above. If the work is done to your satisfaction, confirm completion below.
              </Text>
            )}
          </View>
        )}

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
                  <Text className="text-primary text-sm mt-1">
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
          {isPendingCompletion && (
            <PrimaryButton
              label={
                isCashBooking
                  ? `Confirm Cash Payment · ₱${finalTotal}`
                  : `Confirm & Pay · ₱${finalTotal}`
              }
              fullWidth
              onPress={handleConfirmCompletion}
              disabled={confirmingCompletion || processingPayment}
              loading={confirmingCompletion || processingPayment}
            />
          )}
          {isAwaitingPayment && (
            <PrimaryButton
              label={`Resume Payment · ₱${finalTotal}`}
              fullWidth
              onPress={handleResumePayment}
              disabled={processingPayment}
              loading={processingPayment}
            />
          )}
          {hasQuote && (
            <PrimaryButton
              label="Review & Approve Quote"
              fullWidth
              onPress={() =>
                router.push(`/(client)/booking/${bookingId}/quote`)
              }
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
      <XenditCheckoutModal
        visible={checkoutVisible}
        checkoutUrl={checkoutUrl}
        onSuccess={handleCheckoutSuccess}
        onFailed={handleCheckoutFailed}
        onCancel={handleCheckoutCancel}
      />
    </SafeAreaView>
  );
}
