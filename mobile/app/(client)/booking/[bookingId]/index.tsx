import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { RemoteImage } from "../../../../components/ui/RemoteImage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { usePolling } from "../../../../hooks/usePolling";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import { BookingStatusHero } from "../../../../components/booking-detail/BookingStatusHero";
import { BookingAnswers } from "../../../../components/booking-detail/BookingAnswers";
import { BookingWorkerCard } from "../../../../components/booking-detail/BookingWorkerCard";
import { InvoiceCard } from "../../../../components/booking-detail/InvoiceCard";
import { formatJobTime, getBookingTimeline } from "../../../../utils/bookingTimeline";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import DangerButton from "../../../../components/ui/DangerButton";
import PriceBreakdownCard from "../../../../components/ui/PriceBreakdown";
import { ScreenSkeleton } from "../../../../components/feedback/ScreenSkeleton";
import XenditCheckoutModal from "../../../../components/payment/XenditCheckoutModal";
import { useBookingStore, type Booking } from "../../../../store/bookingStore";
import {
  getBookingDetail,
  confirmBookingCompletion,
  createXenditCheckout,
  getTransactionDetail,
  acknowledgeReschedule as acknowledgeRescheduleApi,
  withdrawRescheduleRequest as withdrawRescheduleRequestApi,
  respondToRescheduleRequest,
  cancelBooking as cancelBookingApi,
  reportReview,
  reportInvoice,
  reportBookingProblem,
} from "../../../../services/api";
import { formatTime12h } from "../../../../utils/bookingTime";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import ReportModal from "../../../../components/modals/ReportModal";
import ProblemReportSheet from "../../../../components/modals/ProblemReportSheet";
import { formatTime } from "../../../../utils/formatTime";
import { mapApiBookingDetail, type ApiBookingDetail } from "../../../../utils/mapBookingDetail";

function formatScheduledDate(date: string): string {
  return new Date(date).toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BookingDetailScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { bookings, prefillFromBooking, prefillFromDeclinedBooking, acknowledgeReschedule } = useBookingStore();
  const [confirmingNewDate, setConfirmingNewDate] = useState(false);
  const [withdrawingReschedule, setWithdrawingReschedule] = useState(false);
  const [cancellingGroup, setCancellingGroup] = useState(false);
  const [answeringReschedule, setAnsweringReschedule] = useState(false);
  const booking = bookings.find((b) => b.id === bookingId);
  const [rawDetail, setRawDetail] = useState<ApiBookingDetail | null>(null);
  const [reportVisible, setReportVisible] = useState(false);
  const [invoiceReportVisible, setInvoiceReportVisible] = useState(false);
  const [reportingInvoice, setReportingInvoice] = useState(false);
  const [problemVisible, setProblemVisible] = useState(false);
  const [reportingProblem, setReportingProblem] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmingCompletion, setConfirmingCompletion] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [focused, setFocused] = useState(false);

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
      setFocused(true);
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
        setFocused(false);
      };
    }, [refreshBookingDetail]),
  );

  usePolling(() => refreshBookingDetail().catch(() => {}), 10000, {
    paused: !focused || confirmingCompletion || processingPayment || checkoutVisible,
  });

  if (loading && !booking) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Booking Details" showBack />
        <ScreenSkeleton />
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

  const priceBreakdown = rawDetail?.priceBreakdown ?? {
    basePrice: null,
    distanceFee: 0,
    tierFee: 0,
    rushFee: 0,
    subtotal: rawDetail?.payment?.subtotal ?? booking.amount,
    addOns: rawDetail?.addOns?.filter((a) => a.clientApprovedAt).map((a) => ({ name: a.name, price: a.price })) ?? [],
    vatApplicable: false,
    vatRate: null,
    vatAmount: 0,
    tip: rawDetail?.payment?.tip ?? 0,
    total: booking.payment?.totalAmount ?? booking.amount,
  };

  const hasWorkerNoShow = !!booking.workerNoShowFlaggedAt;
  const canCancel = booking.status === "Pending" || (hasWorkerNoShow && booking.status !== "Cancelled");
  const canTrack =
    booking.status === "Accepted" || booking.status === "InProgress";
  const hasOpenRescheduleRequest =
    !!rawDetail?.rescheduleRequestedAt && !rawDetail?.rescheduleRequestRespondedAt;
  const workerAskedToReschedule = hasOpenRescheduleRequest && rawDetail?.rescheduleRequestedBy === "WORKER";
  const hasPendingRescheduleRequest = hasOpenRescheduleRequest && !workerAskedToReschedule;
  const workerHasArrived = !!rawDetail?.timeline?.workerArrivedAt;
  const isOpenJob = rawDetail?.status === "ACCEPTED" || rawDetail?.status === "IN_PROGRESS";
  const waitingOnCancelRequest = isOpenJob && !!rawDetail?.cancelRequestedAt && !rawDetail?.cancelRequestEscalatedAt;
  const canReportProblem =
    isOpenJob &&
    !rawDetail?.hasOpenDispute &&
    !waitingOnCancelRequest;
  const canRequestReschedule = rawDetail?.status === "ACCEPTED" && !workerHasArrived && !hasOpenRescheduleRequest;
  const canRequestFollowUp =
    !!rawDetail?.allowsFollowUp &&
    !!booking.workerId &&
    ["PENDING_COMPLETION", "AWAITING_PAYMENT", "COMPLETED"].includes(rawDetail?.status ?? "");
  const upcomingVisits = (rawDetail?.visits ?? []).filter((v) => v.status === "SCHEDULED");
  const invoice = rawDetail?.invoice;
  const invoiceSent = !!invoice && invoice.status !== "NOT_SENT" && invoice.status !== "CANCELLED";
  const invoiceDue = invoice?.status === "DUE";
  const jobTime = formatJobTime(rawDetail?.timeline?.workerStartedAt, rawDetail?.timeline?.workerCompletedAt);
  const requestedWhen = rawDetail?.requestedScheduledDate
    ? `${new Date(rawDetail.requestedScheduledDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" })}${
        rawDetail.requestedScheduledTime ? ` at ${formatTime12h(rawDetail.requestedScheduledTime)}` : ""
      }`
    : "the new date";
  const isCompleted = booking.status === "Completed";
  const isPendingCompletion = booking.status === "PendingCompletion";
  const isAwaitingPayment = booking.status === "AwaitingPayment";
  const isDeclined = booking.status === "Declined" || rawDetail?.status === "REJECTED";

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

  const handleAnswerReschedule = (accept: boolean) => {
    alertModal.confirm(
      accept ? "Accept new time?" : "Keep the original time?",
      accept
        ? `Move this booking to ${requestedWhen}?`
        : "Your booking stays at its original date and time, and your worker is expected to arrive then.",
      {
        confirmText: accept ? "Accept" : "Keep Original",
        onConfirm: async () => {
          setAnsweringReschedule(true);
          try {
            await respondToRescheduleRequest(bookingId, accept);
            await refreshBookingDetail();
          } catch (error: any) {
            console.error("Respond to reschedule request error:", error);
            alertModal.error("Error", error?.message || "Failed to answer the request. Please try again.");
          } finally {
            setAnsweringReschedule(false);
          }
        },
      },
    );
  };

  const handleRequestFollowUp = () => {
    if (!rawDetail || !booking.workerId) return;
    alertModal.confirm(
      "Request a follow-up job?",
      `Ask ${booking.worker} for a new job after this ${booking.service} — e.g. the repair they found. It's a separate job with its own price, and they can accept or decline it.`,
      {
        confirmText: "Continue",
        onConfirm: () => {
          prefillFromDeclinedBooking({ ...rawDetail, scheduledDate: null, scheduledTime: null, timeSlot: null, quantity: null });
          useBookingStore.getState().setDraft({
            entrySource: "book_again",
            parentBookingId: rawDetail.id,
            workerId: booking.workerId ?? null,
            workerName: booking.worker,
            workerAvatar: booking.workerAvatar ?? null,
            workerLocked: true,
          });
          router.push("/(client)/booking/new/step-1");
        },
      },
    );
  };

  const handleFindAnotherPro = () => {
    if (!rawDetail) return;
    prefillFromDeclinedBooking(rawDetail);
    router.push("/(client)/booking/new/step-1");
  };

  const handleCancelEntireJob = () => {
    const siblings = rawDetail?.group?.bookings ?? [];
    const cancellableIds = siblings.filter((b) => b.status === "PENDING").map((b) => b.id);
    if (cancellableIds.length === 0) {
      alertModal.info("Nothing to cancel", "None of the remaining days in this job can still be cancelled.");
      return;
    }

    alertModal.confirm(
      "Cancel entire job?",
      `This cancels every day of this ${booking.groupTotalDays}-day job that's still pending (${cancellableIds.length} of ${siblings.length}). Days a worker has already accepted aren't affected.`,
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

  const bookingMethod = (
    rawDetail?.paymentMethodType ??
    booking.payment?.methodType ??
    "CASH"
  ).toUpperCase();
  const isCashBooking = bookingMethod === "CASH";
  const finalTotal =
    invoice?.total ??
    rawDetail?.payment?.totalAmount ??
    booking.payment?.totalAmount ??
    booking.amount;

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

  const handleResumePayment = async () => {
    if (processingPayment) return;
    setProcessingPayment(true);
    try {
      const result = await createXenditCheckout(booking.id);
      if (result.alreadyPaid) {
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
    refreshBookingDetail().catch(() => {});
  };

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
      console.error("Pay now error:", error);
      alertModal.error(
        "Error",
        "We couldn't start the payment. Please try again.",
      );
    } finally {
      setConfirmingCompletion(false);
    }
  };

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
          <StatusBadge status={booking.status} variant="booking" />
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

        {/* Where the booking is, in one glance */}
        <BookingStatusHero
          timeline={getBookingTimeline(booking.status, {
            scheduledDate: formatScheduledDate(booking.date),
            workerName,
            isCash: isCashBooking,
          })}
        />

        {hasPendingReschedule && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4">
            <View className="flex-row items-center">
              <Ionicons name="calendar" size={22} color={colors.warning} />
              <Text className="font-bold text-sm text-text-primary ml-2 flex-1">
                Your worker needs another day
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

        {workerAskedToReschedule && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4">
            <View className="flex-row items-center">
              <Ionicons name="swap-horizontal" size={22} color={colors.warning} />
              <Text className="font-bold text-sm text-text-primary ml-2 flex-1">Your worker asked to reschedule</Text>
            </View>
            <Text className="text-text-secondary text-xs mt-1.5">
              {workerName} asked to move this booking to {requestedWhen}. If you keep the original time, they&apos;re
              expected to arrive then.
            </Text>
            <View className="flex-row gap-2 mt-3">
              <View className="flex-1">
                <PrimaryButton
                  label="Accept"
                  fullWidth
                  onPress={() => handleAnswerReschedule(true)}
                  disabled={answeringReschedule}
                  loading={answeringReschedule}
                />
              </View>
              <View className="flex-1">
                <OutlinedButton
                  label="Keep Original"
                  fullWidth
                  onPress={() => handleAnswerReschedule(false)}
                  disabled={answeringReschedule}
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
              Waiting for your worker to respond to your request to move this booking to {requestedWhen}.
            </Text>
            <View className="mt-3">
              <OutlinedButton
                label={withdrawingReschedule ? "Withdrawing..." : "Withdraw Request"}
                onPress={handleWithdrawReschedule}
              />
            </View>
          </View>
        )}

        {/* Worker no-show banner */}
        {hasWorkerNoShow && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4 flex-row items-center">
            <Ionicons name="alert-circle" size={24} color={colors.warning} />
            <View className="ml-3 flex-1">
              <Text className="text-warning font-bold text-sm">
                Your worker didn&apos;t show up
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                {booking.status === "Cancelled"
                  ? "This booking was cancelled and you won't be charged. You can book another worker."
                  : "You can cancel this booking for free."}
              </Text>
            </View>
          </View>
        )}

        {rawDetail?.cancellation?.fault === "CLIENT" && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4">
            <Text className="text-warning font-bold text-sm">Cancelled on site</Text>
            <Text className="text-text-secondary text-xs mt-1">
              Your worker cancelled at your location and reported it was caused on your side
              {rawDetail.cancellation.reason ? `: "${rawDetail.cancellation.reason}"` : ""}.{" "}
              {rawDetail.cancellation.compensationStatus === "PENDING_REVIEW"
                ? `HomeEase is reviewing their photo proof. A ₱${rawDetail.cancellation.compensationAmount ?? 0} visit fee (it pays your worker for the trip) applies only if it's confirmed.`
                : rawDetail.cancellation.compensationStatus === "APPROVED"
                  ? `HomeEase confirmed it, so a ₱${rawDetail.cancellation.compensationAmount ?? 0} visit fee applies. It pays your worker for the wasted trip.`
                  : "HomeEase couldn't confirm it, so no fee applies."}
            </Text>
          </View>
        )}

        {rawDetail?.cancellation?.cancelledBy === "WORKER" &&
          rawDetail.cancellation.fault !== "CLIENT" &&
          !!rawDetail.cancellation.reason &&
          !/^[A-Z_]+$/.test(rawDetail.cancellation.reason) && (
            <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4">
              <Text className="text-warning font-bold text-sm">Cancelled by your worker</Text>
              <Text className="text-text-secondary text-xs mt-1">
                Reason: &ldquo;{rawDetail.cancellation.reason}&rdquo;
              </Text>
            </View>
          )}

        {/* This is a follow-up job after an inspection */}
        {rawDetail?.parentBooking && (
          <Pressable
            className="bg-accent/10 rounded-2xl p-4 mb-4 flex-row items-center"
            onPress={() => router.push(`/(client)/booking/${rawDetail.parentBooking!.id}`)}
          >
            <Ionicons name="git-branch-outline" size={20} color={colors.accent.DEFAULT} />
            <Text className="text-text-secondary text-xs ml-2 flex-1">
              Follow-up to your {rawDetail.parentBooking.service} ·{" "}
              {new Date(rawDetail.parentBooking.scheduledDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" })}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
          </Pressable>
        )}

        {waitingOnCancelRequest && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4">
            <Text className="text-text-secondary text-xs">Waiting for your worker to agree to cancel.</Text>
          </View>
        )}

        {rawDetail?.hasOpenDispute && booking.status !== "Disputed" && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4 flex-row items-center">
            <Ionicons name="alert-circle" size={24} color={colors.warning} />
            <View className="ml-3 flex-1">
              <Text className="text-warning font-bold text-sm">Under review</Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                HomeEase is checking it and will contact you.
              </Text>
            </View>
          </View>
        )}

        {rawDetail?.clientNotHereAt && rawDetail.status === "ACCEPTED" && (
          <View className="bg-accent/10 border border-accent/30 rounded-2xl p-4 mb-4">
            <Text className="text-text-secondary text-xs">Your worker is at your door.</Text>
          </View>
        )}

        {canReportProblem && (
          <View className="mb-4">
            <OutlinedButton label="Report a problem" onPress={() => setProblemVisible(true)} />
          </View>
        )}

        {/* Reported invoice, waiting for HomeEase */}
        {booking.status === "Disputed" && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-4 flex-row items-center">
            <Ionicons name="alert-circle" size={24} color={colors.warning} />
            <View className="ml-3 flex-1">
              <Text className="text-warning font-bold text-sm">
                {invoice?.status === "REPORTED" ? "Invoice under review" : "Under review"}
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                HomeEase is checking it and will contact you. Don&apos;t pay until then.
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
                  {workerName && workerName !== "Unassigned" ? `${workerName} declined this booking` : "This worker declined the booking"}
                </Text>
                {!!rawDetail?.declineReason && (
                  <Text className="text-text-primary text-xs mt-1">
                    Reason: &ldquo;{rawDetail.declineReason}&rdquo;
                  </Text>
                )}
                <Text className="text-text-secondary text-xs mt-0.5">
                  Your booking details are saved. Pick another worker to continue.
                </Text>
              </View>
            </View>
            <View className="mt-3">
              <PrimaryButton label="Find Another Worker" fullWidth onPress={handleFindAnotherPro} />
            </View>
          </View>
        )}

        <BookingWorkerCard
          name={workerName}
          avatarUrl={booking.workerAvatar}
          verified={booking.workerVerified}
          onMessage={() => {
            if (!booking.workerId) {
              alertModal.info("Unavailable", "This worker cannot be messaged yet.");
              return;
            }
            router.push(`/(client)/inbox/chat/${booking.workerId}`);
          }}
          onCall={() => {
            if (!booking.workerPhone) {
              alertModal.info("No phone number", "This worker has no phone number on file.");
              return;
            }
            Linking.openURL(`tel:${booking.workerPhone}`).catch(() =>
              alertModal.error("Error", "Could not open the phone dialer."),
            );
          }}
        />

        {/* Service Info */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-secondary text-xs mb-1">Service</Text>
          <Text className="text-text-primary font-bold text-lg">
            {booking.service}
          </Text>
          <BookingAnswers
            quantity={rawDetail?.quantity}
            unit={rawDetail?.quantityUnit}
            answers={rawDetail?.scopeAnswers}
            note={rawDetail?.description}
          />
        </View>

        {/* Date & Address */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <View className="flex-row items-center mb-2">
            <Ionicons name="calendar" size={16} color={colors.accent.DEFAULT} />
            <Text className="text-text-primary font-semibold ml-2">
              {formatScheduledDate(booking.date)}
            </Text>
          </View>
          {booking.time && (
            <View className="flex-row items-center mb-2">
              <Ionicons name="time" size={16} color={colors.accent.DEFAULT} />
              <Text className="text-text-primary font-semibold ml-2">
                Starts {formatTime12h(booking.time)}
                {booking.isRush ? " · Same-day" : ""}
              </Text>
            </View>
          )}
          {upcomingVisits.map((visit) => (
            <View key={visit.id} className="flex-row items-start mb-2">
              <Ionicons name="repeat" size={16} color={colors.accent.DEFAULT} />
              <Text className="text-text-primary text-sm ml-2 flex-1">
                Follow-up visit:{" "}
                {new Date(visit.scheduledDate).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}{" "}
                at {formatTime12h(visit.scheduledTime)}
                {visit.notes ? ` — ${visit.notes}` : ""}
              </Text>
            </View>
          ))}
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

        {invoiceSent && invoice ? (
          <InvoiceCard
            invoice={invoice}
            onOpenPhoto={(url) => router.push({ pathname: "/(client)/inbox/image-viewer", params: { imageUrl: url } })}
          />
        ) : (
        <View className="mb-3">
          <PriceBreakdownCard
            subtotal={priceBreakdown.subtotal}
            basePrice={priceBreakdown.basePrice}
            distanceFee={priceBreakdown.distanceFee}
            distanceFeeNote={"distanceFeeNote" in priceBreakdown ? priceBreakdown.distanceFeeNote : null}
            tierFee={priceBreakdown.tierFee}
            rushFee={priceBreakdown.rushFee}
            materialsCost={"materialsCost" in priceBreakdown ? (priceBreakdown.materialsCost as number | null) : null}
            addOns={priceBreakdown.addOns}
            vatApplicable={priceBreakdown.vatApplicable}
            vatRate={priceBreakdown.vatRate}
            vatAmount={priceBreakdown.vatAmount}
            tip={priceBreakdown.tip}
            total={priceBreakdown.total}
            detailed={true}
          />
        </View>
        )}

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

        {/* Worker's before / progress proof photos */}
        {(!!rawDetail?.beforePhotoUrls?.length || !!rawDetail?.progressPhotoUrls?.length) && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            {[
              ["Before the work", rawDetail?.beforePhotoUrls ?? []],
              ["Progress updates", rawDetail?.progressPhotoUrls ?? []],
            ].map(([label, urls]) =>
              (urls as string[]).length ? (
                <View key={label as string} className="mb-2">
                  <Text className="text-text-primary font-bold mb-2">{label as string}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {(urls as string[]).map((url) => (
                      <Pressable
                        key={url}
                        onPress={() => router.push({ pathname: "/(client)/inbox/image-viewer", params: { imageUrl: url } })}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`Open ${label} photo`}
                      >
                        <RemoteImage source={{ uri: url }} className="w-20 h-20 rounded-xl bg-card-dark" />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null,
            )}
          </View>
        )}

        {/* Completion photo — worker's proof of finished work */}
        {booking.completionPhotoUrl && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold mb-2">
              After photo
            </Text>
            <RemoteImage
              source={{ uri: booking.completionPhotoUrl }}
              style={{ width: "100%", height: 220, borderRadius: 16 }}
              resizeMode="cover"
            />
          </View>
        )}

        {jobTime && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-secondary text-xs mb-1">Job time</Text>
            <Text className="text-text-primary font-semibold">{jobTime}</Text>
          </View>
        )}

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
                {!!rawDetail?.review?.workerResponse && (
                  <View className="bg-background rounded-xl p-3 mt-3">
                    <Text className="text-text-primary font-semibold text-xs mb-1">{booking.worker}&apos;s reply</Text>
                    <Text className="text-text-secondary text-sm">{rawDetail.review.workerResponse}</Text>
                    <Text
                      className="text-text-muted text-xs font-medium mt-2 self-end"
                      onPress={() => setReportVisible(true)}
                    >
                      Report reply
                    </Text>
                  </View>
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
          {invoiceDue && isCashBooking && (
            <View className="bg-accent/10 rounded-2xl p-4">
              <Text className="text-text-primary text-base font-bold text-center">
                Pay ₱{finalTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })} in cash to your worker
              </Text>
              <Text className="text-text-secondary text-sm text-center mt-1">
                Your worker confirms it in their app.
              </Text>
            </View>
          )}
          {isPendingCompletion && !isCashBooking && (
            <PrimaryButton
              label={`Pay Now · ₱${finalTotal}`}
              fullWidth
              onPress={handleConfirmCompletion}
              disabled={confirmingCompletion || processingPayment}
              loading={confirmingCompletion || processingPayment}
            />
          )}
          {isAwaitingPayment && (
            <PrimaryButton
              label={`Pay Now · ₱${finalTotal}`}
              fullWidth
              onPress={handleResumePayment}
              disabled={processingPayment}
              loading={processingPayment}
            />
          )}
          {invoiceDue && (
            <OutlinedButton
              label="Something's wrong with the invoice?"
              fullWidth
              onPress={() => setInvoiceReportVisible(true)}
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
          {canRequestFollowUp && (
            <OutlinedButton label="Request Follow-up Job" onPress={handleRequestFollowUp} />
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
      <ProblemReportSheet
        visible={problemVisible}
        workerArrived={workerHasArrived}
        inProgress={rawDetail?.status === "IN_PROGRESS"}
        loading={reportingProblem}
        onSend={async (reason, note) => {
          setReportingProblem(true);
          try {
            const { outcome, autoCancelAt } = await reportBookingProblem(booking.id, reason, note);
            setProblemVisible(false);
            await refreshBookingDetail();
            const message = {
              WORKER_PINGED: `We pinged your worker. If they're not there by ${autoCancelAt ? formatTime(autoCancelAt) : "soon"}, the booking is cancelled for free.`,
              CANCELLED: "Booking cancelled. You won't be charged.",
              CANCEL_REQUESTED: "We asked your worker. You'll hear back within 2 hours.",
              REPORTED: "Reported. HomeEase will contact you.",
            }[outcome];
            alertModal.success("Done", message);
          } catch (error: any) {
            alertModal.error("Error", error?.message || "Could not send the report. Please try again.");
          } finally {
            setReportingProblem(false);
          }
        }}
        onCancel={() => setProblemVisible(false)}
      />

      <ReportModal
        visible={invoiceReportVisible}
        title="Report the invoice"
        message="Tell us what's wrong, for example a part you didn't get or work that wasn't done. Don't pay yet: HomeEase checks it and contacts you."
        placeholder="e.g. Only one outlet was installed, not two"
        confirmLabel="Send Report"
        minLength={10}
        loading={reportingInvoice}
        onConfirm={async (reason) => {
          setReportingInvoice(true);
          try {
            await reportInvoice(booking.id, reason);
            setInvoiceReportVisible(false);
            await refreshBookingDetail();
            alertModal.success("Reported", "HomeEase will check the invoice and contact you.");
          } catch (error: any) {
            alertModal.error("Error", error?.message || "Could not send the report. Please try again.");
          } finally {
            setReportingInvoice(false);
          }
        }}
        onCancel={() => setInvoiceReportVisible(false)}
      />
      <ReportModal
        visible={reportVisible}
        title="Report this reply"
        loading={reporting}
        onConfirm={async (reason) => {
          setReporting(true);
          try {
            await reportReview(booking.id, reason);
            setReportVisible(false);
            alertModal.success("Reported", "Thanks. An admin will look at it.");
          } catch (error: any) {
            alertModal.error("Error", error?.message || "Could not send the report. Please try again.");
          } finally {
            setReporting(false);
          }
        }}
        onCancel={() => setReportVisible(false)}
      />
    </SafeAreaView>
  );
}
