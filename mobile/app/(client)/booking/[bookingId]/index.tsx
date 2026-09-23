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
} from "../../../../store/bookingStore";
import {
  getBookingDetail,
  confirmBookingCompletion,
  createXenditCheckout,
  getTransactionDetail,
  acknowledgeReschedule as acknowledgeRescheduleApi,
  withdrawRescheduleRequest as withdrawRescheduleRequestApi,
  respondToBookingAddOn,
  cancelBooking as cancelBookingApi,
} from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import type { ConditionType, RoomType, TimeSlot } from "../../../../types/booking4step.types";

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
  condition?: ConditionType | null;
  // Reschedule-on-conflict (see backend bookingController.extendBooking) —
  // rescheduleAcknowledgedAt null means this is still an open episode
  // awaiting the client's explicit response.
  rescheduledAt?: string | null;
  previousScheduledDate?: string | null;
  previousTimeSlot?: TimeSlot | null;
  // The true original date, surviving multiple reschedule hops — differs
  // from previousScheduledDate only after a second+ hop (see backend
  // Booking.originalScheduledDate).
  originalScheduledDate?: string | null;
  rescheduleAcknowledgedAt?: string | null;
  // Set once the worker never checks in past the grace period (see backend
  // bookingWorker.flagWorkerNoShows) — lets the client cancel penalty-free
  // even though the booking is past PENDING.
  workerNoShowFlaggedAt?: string | null;
  // Reschedule-on-REQUEST (see backend requestReschedule) — distinct from
  // the fields above (this booking's spillover moving a DIFFERENT booking).
  // rescheduleRequestRespondedAt null means still awaiting the worker.
  rescheduleRequestedAt?: string | null;
  requestedScheduledDate?: string | null;
  requestedTimeSlot?: TimeSlot | null;
  rescheduleRequestRespondedAt?: string | null;
  rescheduleRequestAccepted?: boolean | null;
  rooms?: RoomType[];
  scopeAnswers?: Record<string, string | string[]> | null;
  scheduledDate: string;
  scheduledTime: string | null;
  estimatedPrice: number;
  finalPrice: number | null;
  vatApplicable?: boolean;
  vatRate?: number | null;
  priceBreakdown?: {
    basePrice: number | null;
    distanceFee: number;
    tierFee: number;
    addOns: { name: string; price: number }[];
    subtotal: number;
    vatApplicable: boolean;
    vatRate: number | null;
    vatAmount: number;
    tip: number;
    total: number;
  };
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
  addOns?: { id: string; name: string; price: number; clientApprovedAt: string | null; clientRejectedAt: string | null }[];
  // Multi-day upfront booking (see backend createMultiDayBooking) — null for
  // an ordinary single-day booking. Sibling list is date-ordered.
  groupId?: string | null;
  group?: { totalDays: number; bookings: { id: string; scheduledDate: string; status: string }[] } | null;
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
    priceBreakdown: d.priceBreakdown ?? null,
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
    rescheduledAt: d.rescheduledAt,
    previousScheduledDate: d.previousScheduledDate,
    previousTimeSlot: d.previousTimeSlot,
    originalScheduledDate: d.originalScheduledDate,
    rescheduleAcknowledgedAt: d.rescheduleAcknowledgedAt,
    workerNoShowFlaggedAt: d.workerNoShowFlaggedAt,
    groupId: d.groupId ?? undefined,
    groupTotalDays: d.group?.totalDays ?? undefined,
    groupDayIndex: d.group ? d.group.bookings.findIndex((b) => b.id === d.id) + 1 : undefined,
  };
}

export default function BookingDetailScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, prefillFromBooking, prefillFromDeclinedBooking, acknowledgeReschedule } = useBookingStore();
  const [confirmingNewDate, setConfirmingNewDate] = useState(false);
  const [withdrawingReschedule, setWithdrawingReschedule] = useState(false);
  const [cancellingGroup, setCancellingGroup] = useState(false);
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

  const refreshBookingDetail = React.useCallback(async () => {
    const data: ApiBookingDetail = await getBookingDetail(bookingId);
    const mapped = mapApiBookingDetail(data);
    setRawDetail(data);
    useBookingStore.setState((s) => ({
      bookings: [...s.bookings.filter((b) => b.id !== mapped.id), mapped],
    }));
    return data;
  }, [bookingId]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        try {
          await refreshBookingDetail();
        } catch (error) {
          if (!cancelled) console.error("Load booking detail error:", error);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [refreshBookingDetail]),
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
  const pendingAddOns = rawDetail?.addOns?.filter((a) => !a.clientApprovedAt && !a.clientRejectedAt) ?? [];

  // Prefer the server-assembled breakdown (basePrice/distanceFee/tierFee
  // from the booking's PricingLog, VAT from settlement) — falls back to a
  // collapsed subtotal/addOns/tip/total for bookings fetched before that
  // field existed on the backend response.
  const priceBreakdown = rawDetail?.priceBreakdown ?? {
    basePrice: null,
    distanceFee: 0,
    tierFee: 0,
    subtotal: rawDetail?.payment?.subtotal ?? booking.amount,
    // Only approved add-ons count toward the total — a still-pending one
    // shown here would look like it's already been billed.
    addOns: rawDetail?.addOns?.filter((a) => a.clientApprovedAt).map((a) => ({ name: a.name, price: a.price })) ?? [],
    vatApplicable: false,
    vatRate: null,
    vatAmount: 0,
    tip: rawDetail?.payment?.tip ?? 0,
    total: booking.payment?.totalAmount ?? booking.amount,
  };

  const [respondingAddonId, setRespondingAddonId] = useState<string | null>(null);
  const handleAddonResponse = async (addonId: string, approve: boolean) => {
    setRespondingAddonId(addonId);
    try {
      await respondToBookingAddOn(booking.id, addonId, approve);
      await refreshBookingDetail();
    } catch (error) {
      console.error("Respond to addon error:", error);
      alertModal.error("Error", "Failed to respond to this addon. Please try again.");
    } finally {
      setRespondingAddonId(null);
    }
  };

  const statusCaption: Partial<Record<Booking["status"], string>> = {
    QuoteSubmitted: "Action required",
    Disputed: "Under review",
    PendingCompletion: "Action required",
    AwaitingPayment: "Payment required",
  };

  // Same free-cancel carve-out as a forced reschedule (see
  // hasPendingReschedule below) — the client didn't choose either
  // situation, so backing out shouldn't be blocked past PENDING here.
  const hasWorkerNoShow = !!booking.workerNoShowFlaggedAt;
  const canCancel = booking.status === "Pending" || hasWorkerNoShow;
  const canTrack =
    booking.status === "Accepted" || booking.status === "InProgress";
  // Client-initiated reschedule request — only on an ACCEPTED booking
  // (before the worker arrives/starts), and only one live request at a time.
  const hasPendingRescheduleRequest =
    !!rawDetail?.rescheduleRequestedAt && !rawDetail?.rescheduleRequestRespondedAt;
  const canRequestReschedule = rawDetail?.status === "ACCEPTED" && !hasPendingRescheduleRequest;
  const isCompleted = booking.status === "Completed";
  const isPendingCompletion = booking.status === "PendingCompletion";
  const isAwaitingPayment = booking.status === "AwaitingPayment";
  const hasQuote = booking.status === "QuoteSubmitted" && booking.quote;
  // Distinct from a client-initiated cancel — both collapse to the same
  // "Cancelled" bucket in booking.status (see API_STATUS_MAP), so this
  // checks the raw backend status instead, to only offer "Find Another
  // Pro" when a worker actually declined the request.
  const isDeclined = rawDetail?.status === "REJECTED";

  // A different job's spillover (see backend extendBooking) moved this
  // booking to a new date — resolved once the client explicitly keeps it,
  // or the 24h auto-confirm sweep does it for them.
  const hasPendingReschedule = !!booking.rescheduledAt && !booking.rescheduleAcknowledgedAt;

  const handleKeepNewDate = () => {
    alertModal.confirm(
      "Keep New Date",
      `Keep ${booking.date ? new Date(booking.date).toLocaleDateString("en-PH", { month: "long", day: "numeric" }) : "the new date"} for this booking?`,
      {
        confirmText: "Keep Date",
        onConfirm: async () => {
          setConfirmingNewDate(true);
          try {
            await acknowledgeRescheduleApi(bookingId);
            acknowledgeReschedule(bookingId);
            await refreshBookingDetail();
            alertModal.success("Confirmed", "The new date is now confirmed.");
          } catch (error) {
            console.error("Acknowledge reschedule error:", error);
            alertModal.error("Error", "Failed to confirm the new date. Please try again.");
          } finally {
            setConfirmingNewDate(false);
          }
        },
      },
    );
  };

  const handleWithdrawReschedule = () => {
    alertModal.confirm(
      "Withdraw Request",
      "Withdraw your reschedule request? Your booking will stay at its current date and time.",
      {
        confirmText: "Withdraw",
        onConfirm: async () => {
          setWithdrawingReschedule(true);
          try {
            await withdrawRescheduleRequestApi(bookingId);
            await refreshBookingDetail();
          } catch (error) {
            console.error("Withdraw reschedule request error:", error);
            alertModal.error("Error", "Failed to withdraw your request. Please try again.");
          } finally {
            setWithdrawingReschedule(false);
          }
        },
      },
    );
  };

  const handleFindAnotherPro = () => {
    if (!rawDetail) return;
    prefillFromDeclinedBooking(rawDetail);
    router.push("/(client)/booking/new/step-1");
  };

  // Convenience action for a multi-day upfront booking (see backend
  // createMultiDayBooking) — purely client-side: iterates every sibling day
  // still in a cancellable state and calls the SAME single-booking cancel
  // endpoint used everywhere else, one at a time. Each day cancels/frees its
  // own slot completely independently (this booking's status flow is
  // unmodified per day, same as a normal single-day booking) — a day
  // already ACCEPTED or further along is simply skipped, not force-cancelled,
  // same as the single "Cancel Booking" action would refuse it on its own.
  const handleCancelEntireJob = () => {
    const siblings = rawDetail?.group?.bookings ?? [];
    const cancellableIds = siblings.filter((b) => b.status === "PENDING").map((b) => b.id);
    if (cancellableIds.length === 0) {
      alertModal.info("Nothing to cancel", "None of the remaining days in this job can still be cancelled.");
      return;
    }

    alertModal.confirm(
      "Cancel entire job?",
      `This cancels every day of this ${booking.groupTotalDays}-day job that's still pending (${cancellableIds.length} of ${siblings.length}). Days a pro has already accepted aren't affected.`,
      {
        confirmText: "Cancel Entire Job",
        destructive: true,
        onConfirm: async () => {
          setCancellingGroup(true);
          const results = await Promise.allSettled(
            cancellableIds.map((id) => cancelBookingApi(id, "Cancelled by client via Cancel Entire Job")),
          );
          setCancellingGroup(false);
          const failed = results.filter((r) => r.status === "rejected").length;
          try {
            await refreshBookingDetail();
          } catch (error) {
            console.error("Refresh after cancel-entire-job error:", error);
          }
          if (failed > 0) {
            alertModal.error(
              "Some days couldn't be cancelled",
              `${cancellableIds.length - failed} of ${cancellableIds.length} pending days were cancelled. The rest may have just been accepted — check My Bookings.`,
            );
          } else {
            alertModal.success("Job cancelled", `${cancellableIds.length} pending day(s) were cancelled.`);
          }
        },
      },
    );
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
      const result = await createXenditCheckout(booking.id);
      if (result.alreadyPaid) {
        // Server found this already PAID on Xendit's side (webhook was
        // missed/delayed) and self-healed it — no checkout to open.
        await refreshBookingDetail();
        setProcessingPayment(false);
        alertModal.success(
          "Payment successful",
          "The worker has been paid. Thank you!",
        );
        return;
      }
      openCheckout(result.checkoutUrl);
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
          {!!booking.groupTotalDays && (
            <View className="bg-accent/10 rounded-full px-2 py-0.5">
              <Text className="text-accent text-[11px] font-bold">
                Day {booking.groupDayIndex ?? "?"} of {booking.groupTotalDays}
              </Text>
            </View>
          )}
          <Text
            className="text-text-secondary text-xs ml-auto flex-shrink"
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            ID: {booking.id}
          </Text>
        </View>

        {/* Reschedule banner — placed first, most time-sensitive */}
        {hasPendingReschedule && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4">
            <View className="flex-row items-center">
              <Ionicons name="calendar" size={22} color={colors.warning} />
              <Text className="font-bold text-sm text-text-primary ml-2 flex-1">
                Your pro needs another day
              </Text>
            </View>
            <Text className="text-text-secondary text-xs mt-1.5">
              Moved from{" "}
              {booking.previousScheduledDate
                ? new Date(booking.previousScheduledDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
                : "the original date"}{" "}
              to{" "}
              {booking.date
                ? new Date(booking.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
                : "a new date"}
              . Keep it, or cancel free of charge.
            </Text>
            {/* Only shown once a second+ hop has happened — otherwise this
                is identical to "Moved from" above and would be redundant. */}
            {booking.originalScheduledDate &&
              booking.previousScheduledDate &&
              booking.originalScheduledDate !== booking.previousScheduledDate && (
                <Text className="text-text-muted text-xs mt-1">
                  Originally booked for{" "}
                  {new Date(booking.originalScheduledDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}.
                </Text>
              )}
            <View className="flex-row gap-2 mt-3">
              <View className="flex-1">
                <PrimaryButton
                  label="Accept"
                  fullWidth
                  onPress={handleKeepNewDate}
                  disabled={confirmingNewDate}
                  loading={confirmingNewDate}
                />
              </View>
              <View className="flex-1">
                <OutlinedButton
                  label="Cancel"
                  fullWidth
                  onPress={() => router.push(`/(client)/booking/${bookingId}/cancel`)}
                />
              </View>
            </View>
          </View>
        )}

        {/* Pending client-initiated reschedule request */}
        {hasPendingRescheduleRequest && (
          <View className="bg-accent/10 border border-accent/30 rounded-2xl p-4 mb-4">
            <View className="flex-row items-center">
              <Ionicons name="time" size={22} color={colors.accent.DEFAULT} />
              <Text className="font-bold text-sm text-text-primary ml-2 flex-1">
                Reschedule request sent
              </Text>
            </View>
            <Text className="text-text-secondary text-xs mt-1.5">
              Waiting for your pro to respond to your request to move this booking to{" "}
              {rawDetail?.requestedScheduledDate
                ? new Date(rawDetail.requestedScheduledDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
                : "the new date"}
              .
            </Text>
            <View className="mt-3">
              <OutlinedButton
                label={withdrawingReschedule ? "Withdrawing..." : "Withdraw Request"}
                onPress={handleWithdrawReschedule}
              />
            </View>
          </View>
        )}

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

        {/* Worker no-show banner */}
        {hasWorkerNoShow && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4 flex-row items-center">
            <Ionicons name="alert-circle" size={24} color={colors.warning} />
            <View className="ml-3 flex-1">
              <Text className="text-warning font-bold text-sm">
                Your worker hasn't checked in
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                You can cancel this booking for free.
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
                  Your booking details are saved. Pick another pro to continue.
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
                <Text className="text-text-primary font-semibold">{workerName}</Text>
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
            <Text className="text-text-primary font-semibold ml-2">
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
              <Text className="text-text-primary font-semibold ml-2">
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
              <Text className="text-text-primary font-semibold ml-2 flex-1">
                {booking.address}
              </Text>
            </View>
          )}
        </View>

        {/* Pending add-ons — awaiting client approval before they're billed */}
        {pendingAddOns.length > 0 && (
          <View className="bg-card rounded-2xl p-4 mb-3 border border-warning/40">
            <Text className="text-text-primary font-semibold mb-2">
              Additional services need your approval
            </Text>
            {pendingAddOns.map((addon) => (
              <View key={addon.id} className="mb-3">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-text-primary flex-1 mr-2">{addon.name}</Text>
                  <Text className="text-text-primary font-semibold">
                    ₱{addon.price.toLocaleString()}
                  </Text>
                </View>
                <View className="flex-row" style={{ gap: 8 }}>
                  <View className="flex-1">
                    <OutlinedButton
                      label="Reject"
                      onPress={() => handleAddonResponse(addon.id, false)}
                      disabled={respondingAddonId === addon.id}
                    />
                  </View>
                  <View className="flex-1">
                    <PrimaryButton
                      label="Approve"
                      onPress={() => handleAddonResponse(addon.id, true)}
                      disabled={respondingAddonId === addon.id}
                      loading={respondingAddonId === addon.id}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Price Breakdown */}
        <View className="mb-3">
          <PriceBreakdownCard
            subtotal={priceBreakdown.subtotal}
            basePrice={priceBreakdown.basePrice}
            distanceFee={priceBreakdown.distanceFee}
            tierFee={priceBreakdown.tierFee}
            addOns={priceBreakdown.addOns}
            vatApplicable={priceBreakdown.vatApplicable}
            vatRate={priceBreakdown.vatRate}
            vatAmount={priceBreakdown.vatAmount}
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
            <Text className="text-text-primary font-semibold ml-3">
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
                Happy with the work? Confirm completion below.
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
                  <Text className="text-text-primary text-sm mt-1">
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
          {canRequestReschedule && (
            <OutlinedButton
              label="Request Reschedule"
              onPress={() =>
                router.push(`/(client)/booking/${bookingId}/request-reschedule`)
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
          {!!booking.groupTotalDays && booking.groupTotalDays > 1 && (
            <OutlinedButton
              label={cancellingGroup ? "Cancelling..." : "Cancel Entire Job"}
              onPress={handleCancelEntireJob}
              disabled={cancellingGroup}
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
