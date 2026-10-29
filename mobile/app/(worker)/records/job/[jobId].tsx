import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Image, ScrollView, Share } from "react-native";
import { RemoteImage } from "../../../../components/ui/RemoteImage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import StepperVertical from "../../../../components/steppers/StepperVertical";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import DangerButton from "../../../../components/ui/DangerButton";
import UploadCard from "../../../../components/ui/UploadCard";
import StarRating from "../../../../components/ui/StarRating";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import ProofPhotosField from "../../../../components/booking/ProofPhotosField";
import InvoiceLineModal from "../../../../components/modals/InvoiceLineModal";
import { InvoiceCard } from "../../../../components/booking-detail/InvoiceCard";
import { BookingAnswers } from "../../../../components/booking-detail/BookingAnswers";
import type { ApiInvoice } from "../../../../utils/mapBookingDetail";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { API_STATUS_MAP } from "../../../../store/bookingStore";
import * as api from "../../../../services/api";
import { getCurrentPosition, watchLiveLocation, LocationPermissionDeniedError } from "../../../../services/location";
import type { LocationSubscription } from "expo-location";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import { usePolling } from "../../../../hooks/usePolling";
import { colors } from "../../../../constants";
import { bookingStartTime, formatTime12h, startInstant } from "../../../../utils/bookingTime";
import { formatJobTime } from "../../../../utils/bookingTimeline";

// Mirrors AppSettings.noShowGraceMinutes / noShowPenaltyAmount defaults —
// only used for the on-screen warning; the server decides.
const NO_SHOW_GRACE_MINUTES = 60;
const NO_SHOW_PENALTY = 200;

// A real-time socket layer already pushes updates here — this poll is a
// belt-and-suspenders fallback, not the primary refresh path.
const POLL_INTERVAL_MS = 25000;

type BookingDetail = {
  id: string;
  client: { id: string; fullName: string; phone?: string | null };
  service: string;
  // How many units (per-unit jobs), old bookings' question answers, and the client's note.
  quantity?: number | null;
  quantityUnit?: string | null;
  scopeAnswers?: Record<string, string | string[]> | null;
  description?: string | null;
  status: string;
  scheduledDate: string;
  scheduledTime?: string | null;
  timeSlot?: string | null;
  isRush?: boolean;
  estimatedPrice: number;
  finalPrice: number | null;
  tip?: number | null;
  completionPhotoUrl?: string | null;
  beforePhotoUrls?: string[];
  progressPhotoUrls?: string[];
  addOns?: { id: string; kind: string | null; name: string; price: number; clientApprovedAt: string | null; clientRejectedAt: string | null }[];
  workerArrivedAt?: string | null;
  timeline?: { workerArrivedAt?: string | null; workerStartedAt?: string | null; workerCompletedAt?: string | null } | null;
  // Set when a no-show cancelled this job (see backend
  // bookingWorker.cancelWorkerNoShows).
  workerNoShowFlaggedAt?: string | null;
  review?: { rating: number; comment: string | null } | null;
  // Reschedule request (see backend requestReschedule) — either side asks,
  // the other answers; rescheduleRequestRespondedAt null means still open.
  rescheduleRequestedAt?: string | null;
  rescheduleRequestedBy?: "CLIENT" | "WORKER" | null;
  requestedScheduledDate?: string | null;
  requestedScheduledTime?: string | null;
  requestedTimeSlot?: string | null;
  rescheduleRequestRespondedAt?: string | null;
  // "Follow Up Date" visits (see scheduleFollowUpVisit).
  visits?: { id: string; scheduledDate: string; scheduledTime: string; notes: string | null; status: string }[];
  // The bill the worker sends at the end of the job (see backend completeBooking).
  invoice?: ApiInvoice;
  paymentMethodType?: "CASH" | "GCASH" | "MAYA" | null;
  // Client no-show and cancel-request state (see backend clientNotHere / requestCancel).
  clientNotHereAt?: string | null;
  clientNoShowCancelAt?: string | null;
  clientFaultFeeAmount?: number;
  noShowGraceMinutes?: number;
  cancelRequestedAt?: string | null;
  cancelRequestReason?: string | null;
  cancelRequestEscalatedAt?: string | null;
  parentBooking?: { id: string; service: string } | null;
  payment?: {
    status: string;
    escrowStatus: string;
    subtotal?: number;
    tip?: number;
    commissionAmount?: number;
    withholdingTaxAmount?: number;
    workerPayout?: number;
    capturedAmount?: number | null;
  } | null;
  // The worker's take-home from the server, at the real service-fee rate.
  earnings?: {
    subtotal: number;
    commissionAmount: number;
    withholdingTaxAmount: number;
    workerPayout: number;
  } | null;
};

// Dates arrive as UTC-midnight ISO strings; show them as "Oct 18, 2026".
const formatJobDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

export default function JobDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [job, setJob] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [respondingToReschedule, setRespondingToReschedule] = useState(false);
  const [completionPhotoUri, setCompletionPhotoUri] = useState<string | null>(null);
  const [completionPhotoUrl, setCompletionPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Proof photos, both posted after the start and both needed to finish:
  // before (the job as found) and progress.
  const [beforeDraft, setBeforeDraft] = useState<string[]>([]);
  const [postingBefore, setPostingBefore] = useState(false);
  const [progressDraft, setProgressDraft] = useState<string[]>([]);
  const [postingProgress, setPostingProgress] = useState(false);
  // Parts and extra work added to the invoice before it's sent.
  const [invoiceItems, setInvoiceItems] = useState<api.InvoiceItemPayload[]>([]);
  const [lineModalKind, setLineModalKind] = useState<api.InvoiceItemPayload["kind"] | null>(null);
  const [confirmingCash, setConfirmingCash] = useState(false);
  // Which of the new one-tap controls is mid-request, to block double taps.
  const [busyAction, setBusyAction] = useState<null | "agree" | "decline" | "notHere" | "noShowCancel" | "notPaid">(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const [focused, setFocused] = useState(false);
  const photoSheetRef = useRef<BottomSheetHandle | null>(null);
  const alertModal = useAlertModal();

  // `silent` skips the loading flag so a background poll refresh doesn't
  // flash the skeleton over an already-rendered screen.
  const load = useCallback(
    async (silent = false) => {
      if (!jobId) return;
      if (!silent) setLoading(true);
      try {
        const detail = await api.getBookingDetail(jobId);
        setJob(detail);
      } catch (error) {
        console.error("Load job detail error:", error);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [jobId],
  );

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      load();
      return () => setFocused(false);
    }, [load]),
  );

  // Picks up status changes made elsewhere (e.g. an admin resolving a
  // dispute, or the client cancelling) without requiring a screen refocus.
  usePolling(() => load(true), POLL_INTERVAL_MS, { paused: !focused });

  const jobTime = formatJobTime(job?.timeline?.workerStartedAt, job?.timeline?.workerCompletedAt);

  // Streams live GPS to the client while en route (ACCEPTED, not yet checked
  // in) so their "Track Service" map can show a moving marker. Stops as soon
  // as the worker checks in as arrived, the job leaves ACCEPTED, or the
  // screen loses focus — there's nothing left worth tracking once on-site,
  // and no reason to burn battery watching GPS from a backgrounded screen.
  const jobStatus = job ? API_STATUS_MAP[job.status] ?? "Pending" : null;
  const hasArrivedForTracking = !!(job?.workerArrivedAt || job?.timeline?.workerArrivedAt);
  const shouldShareLocation = focused && jobStatus === "Accepted" && !hasArrivedForTracking;

  useEffect(() => {
    if (!shouldShareLocation || !job?.id) return;

    let cancelled = false;
    let subscription: LocationSubscription | null = null;

    watchLiveLocation((position) => {
      api.updateWorkerLiveLocation(job.id, position.lat, position.lng, position.accuracy).catch((error) => {
        console.error("Live location push error:", error);
      });
    })
      .then((sub) => {
        if (cancelled) {
          sub.remove();
          return;
        }
        subscription = sub;
      })
      .catch((error) => {
        console.error("Start live location tracking error:", error);
      });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [shouldShareLocation, job?.id]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Job Detail" showBack />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          <View className="items-center mb-4">
            <Skeleton width={90} height={22} borderRadius={11} marginBottom={0} />
          </View>
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Skeleton width="60%" height={18} marginBottom={8} />
            <Skeleton width="40%" height={12} marginBottom={6} />
            <Skeleton width="30%" height={10} marginBottom={0} />
          </View>
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Skeleton width="35%" height={10} marginBottom={8} />
            <Skeleton width="30%" height={24} marginBottom={0} />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Job Detail" showBack />
        <View className="flex-1 items-center justify-center">
          <Text className="text-text-secondary">Job not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const status = API_STATUS_MAP[job.status] ?? "Pending";
  const isAccepted = status === "Accepted";
  const isInProgress = status === "InProgress";
  const isDisputed = status === "Disputed";
  const isPendingCompletion = status === "PendingCompletion";
  const isAwaitingPayment = status === "AwaitingPayment";
  const isCompleted = status === "Completed";
  const amount = job.finalPrice ?? job.estimatedPrice;
  // `payment.tip` once a Payment row exists (post-completion), else the raw
  // tip the client committed at booking time — available from Pending on,
  // so it's visible before the worker even accepts the job.
  const tip = job.payment?.tip ?? job.tip ?? 0;
  const hasArrived = !!(job.workerArrivedAt || job.timeline?.workerArrivedAt);
  const hasOpenRescheduleRequest = !!job.rescheduleRequestedAt && !job.rescheduleRequestRespondedAt;
  // The client asked (or an older request from before either side could ask).
  const hasPendingRescheduleRequest = hasOpenRescheduleRequest && job.rescheduleRequestedBy !== "WORKER";
  const iAskedToReschedule = hasOpenRescheduleRequest && job.rescheduleRequestedBy === "WORKER";
  const canRequestReschedule = isAccepted && !hasArrived && !hasOpenRescheduleRequest;
  // Work under way — another visit can be planned for a job that needs more days.
  const canScheduleVisit = isInProgress;
  const isCash = (job.paymentMethodType ?? "CASH") === "CASH";
  // The job starts right after check-in, or with check-in in the same tap.
  const canStartNow = isAccepted;
  const invoice = job.invoice;
  const invoiceSent = !!invoice && (invoice.status === "DUE" || invoice.status === "REPORTED" || invoice.status === "PAID");
  // What the client will be asked to pay: the booked price (packages
  // included), the lines added here, and the tip.
  const draftInvoiceTotal = amount + invoiceItems.reduce((sum, item) => sum + item.price, 0) + tip;
  const bookedPackages = (job.addOns ?? []).filter((a) => a.clientApprovedAt && a.price > 0 && a.kind !== "PART" && a.kind !== "EXTRA_WORK");
  // Open jobs only: an agreed request stays on the row after the cancel.
  const hasCancelRequest = (isAccepted || isInProgress) && !!job.cancelRequestedAt && !job.cancelRequestEscalatedAt;
  const waitingForClient = isAccepted && hasArrived && !!job.clientNotHereAt && !!job.clientNoShowCancelAt;
  const noShowCancelOpen = waitingForClient && now >= new Date(job.clientNoShowCancelAt!).getTime();
  // Hidden while a better path exists: the client's cancel request, or the no-show cancel.
  const canCancelJob = (isAccepted || isInProgress) && !hasCancelRequest && !noShowCancelOpen;
  const startTime = bookingStartTime(job);
  const startsAt = startTime ? startInstant(job.scheduledDate.slice(0, 10), startTime) : null;
  const startPassed = !!startsAt && now >= startsAt.getTime();
  const graceMinutes = job.noShowGraceMinutes ?? NO_SHOW_GRACE_MINUTES;
  // Past start + grace without a check-in, the worker is the late one.
  const pastGrace = !!startsAt && now > startsAt.getTime() + graceMinutes * 60_000;
  const upcomingVisits = (job.visits ?? []).filter((v) => v.status === "SCHEDULED");
  const requestedWhen = job.requestedScheduledDate
    ? `${new Date(job.requestedScheduledDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" })}${
        job.requestedScheduledTime ? ` at ${formatTime12h(job.requestedScheduledTime)}` : ""
      }`
    : "a new date"

  // The server's earnings use the settled Payment once one exists, else the
  // service-fee rate settlement will use (same numbers as the request screen).
  // The 10% fallback only covers an old server that doesn't send earnings.
  // Tip is never commissioned or taxed, so it's added on top.
  const earnings = job.earnings;
  const payoutEstimate = earnings?.workerPayout ?? job.payment?.workerPayout ?? amount * 0.9 + tip;
  const commissionEstimate = earnings?.commissionAmount ?? job.payment?.commissionAmount ?? amount * 0.1;
  const taxEstimate = earnings?.withholdingTaxAmount ?? job.payment?.withholdingTaxAmount ?? 0;
  const feeSubtotal = earnings?.subtotal ?? job.payment?.subtotal ?? amount;

  const steps = [
    { label: "Confirmed", timestamp: formatJobDate(job.scheduledDate), status: "done" as const },
    {
      label: "Arrived",
      timestamp: "",
      status: hasArrived ? ("done" as const) : isAccepted ? ("active" as const) : ("pending" as const),
    },
    {
      label: "Ongoing",
      timestamp: "",
      status: invoiceSent || isCompleted ? ("done" as const) : isInProgress ? ("active" as const) : ("pending" as const),
    },
    {
      label: "Paid",
      timestamp: "",
      status: isCompleted ? ("done" as const) : invoiceSent ? ("active" as const) : ("pending" as const),
    },
  ];

  // GPS check-in. Shows its own error and returns false when it fails.
  const checkIn = async () => {
    try {
      const position = await getCurrentPosition();
      await api.arriveBooking(job.id, position.lat, position.lng, position.accuracy, position.mocked);
      return true;
    } catch (error) {
      if (error instanceof LocationPermissionDeniedError) {
        alertModal.error("Location needed", "Please enable location access to check in at the job site.");
      } else {
        const message = error instanceof Error ? error.message : "Failed to verify your arrival.";
        alertModal.error("Can't check in yet", message);
      }
      return false;
    }
  };

  const handleStart = async () => {
    setSubmitting(true);
    try {
      // One tap checks in and starts a job with a set price.
      if (!hasArrived && !(await checkIn())) return;
      await api.startBooking(job.id);
      alertModal.success(
        "Job Started",
        "Take a photo of the job before you begin, post a progress photo while you work, then send the invoice with a photo of the finished job.",
      );
      load();
    } catch (error) {
      console.error("Start booking error:", error);
      // Show the server's reason (no before photo, not checked in yet…);
      // the generic text hid what the worker needs to do.
      const message = error instanceof Error && error.message ? error.message : "Failed to start this job. Please try again.";
      alertModal.error("Can't start this job", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostBefore = async () => {
    setPostingBefore(true);
    try {
      await api.addBeforePhotos(job.id, beforeDraft);
      setBeforeDraft([]);
      load(true);
    } catch (error) {
      console.error("Post before photos error:", error);
      alertModal.error("Error", "Failed to save the photo. Please try again.");
    } finally {
      setPostingBefore(false);
    }
  };

  const handlePostProgress = async () => {
    setPostingProgress(true);
    try {
      await api.addProgressPhotos(job.id, progressDraft);
      setProgressDraft([]);
      load(true);
    } catch (error) {
      console.error("Post progress photos error:", error);
      alertModal.error("Error", "Failed to post the update. Please try again.");
    } finally {
      setPostingProgress(false);
    }
  };

  const handleRespondToReschedule = (accept: boolean) => {
    alertModal.confirm(
      accept ? "Accept New Date?" : "Decline New Date?",
      accept
        ? "This will move the booking to the client's proposed date and time."
        : "The client will be notified and the booking stays at its current date.",
      {
        confirmText: accept ? "Accept" : "Decline",
        destructive: !accept,
        onConfirm: async () => {
          setRespondingToReschedule(true);
          try {
            await api.respondToRescheduleRequest(job.id, accept);
            alertModal.success(accept ? "Reschedule Accepted" : "Reschedule Declined", "The client has been notified.");
            load();
          } catch (error: any) {
            console.error("Respond to reschedule request error:", error);
            alertModal.error("Error", error?.message || "Failed to respond to the reschedule request. Please try again.");
            load();
          } finally {
            setRespondingToReschedule(false);
          }
        },
      },
    );
  };

  const handleWithdrawMyReschedule = () => {
    alertModal.confirm("Withdraw Request?", "The booking stays at its current date and time.", {
      confirmText: "Withdraw",
      onConfirm: async () => {
        try {
          await api.withdrawRescheduleRequest(job.id);
          load();
        } catch (error: any) {
          console.error("Withdraw reschedule request error:", error);
          alertModal.error("Error", error?.message || "Failed to withdraw the request. Please try again.");
          load();
        }
      },
    });
  };

  const handleCancelVisit = (visitId: string) => {
    alertModal.confirm("Cancel this visit?", "The client will be told the follow-up visit is off.", {
      confirmText: "Cancel Visit",
      destructive: true,
      onConfirm: async () => {
        try {
          await api.cancelFollowUpVisit(job.id, visitId);
          load();
        } catch (error) {
          console.error("Cancel visit error:", error);
          alertModal.error("Error", "Failed to cancel the visit. Please try again.");
        }
      },
    });
  };

  const handleSelectCompletionPhoto = async (uri: string) => {
    setCompletionPhotoUri(uri);
    setCompletionPhotoUrl(null);
    setUploadingPhoto(true);
    try {
      const { url } = await api.uploadBookingCompletionPhoto(job.id, uri);
      setCompletionPhotoUrl(url);
    } catch (error) {
      console.error("Upload completion photo error:", error);
      alertModal.error("Error", "Failed to upload photo. Please try again.");
      setCompletionPhotoUri(null);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSendInvoice = () => {
    if (!completionPhotoUrl) return;
    alertModal.confirm(
      "Send the invoice?",
      isCash
        ? `The client will be asked to pay you ₱${draftInvoiceTotal.toFixed(2)} in cash. Tap Cash received once they do.`
        : `The client will be asked to pay ₱${draftInvoiceTotal.toFixed(2)} with ${job.paymentMethodType === "MAYA" ? "Maya" : "GCash"} in the app.`,
      {
        confirmText: "Send Invoice",
        cancelText: "Cancel",
        onConfirm: async () => {
          setSubmitting(true);
          try {
            await api.completeBooking(job.id, completionPhotoUrl, invoiceItems);
            setInvoiceItems([]);
            alertModal.success(
              "Invoice sent",
              isCash ? "Collect the cash, then tap Cash received." : "You're paid once the client's payment comes in.",
            );
            load();
          } catch (error: any) {
            console.error("Send invoice error:", error);
            alertModal.error("Error", error?.message || "Failed to send the invoice. Please try again.");
          } finally {
            setSubmitting(false);
          }
        },
      },
    );
  };

  const handleCashReceived = () => {
    alertModal.confirm(
      "Cash received?",
      `Confirm the client paid you ₱${(invoice?.total ?? amount + tip).toFixed(2)} in cash.`,
      {
        confirmText: "Cash Received",
        cancelText: "Not Yet",
        onConfirm: async () => {
          setConfirmingCash(true);
          try {
            await api.markCashReceived(job.id);
            alertModal.success("Job done", "Nice work. The cash payment is recorded.", [{ text: "OK", onPress: () => router.back() }]);
          } catch (error: any) {
            console.error("Cash received error:", error);
            alertModal.error("Error", error?.message || "Failed to record the payment. Please try again.");
            load();
          } finally {
            setConfirmingCash(false);
          }
        },
      },
    );
  };

  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  // Runs one action with a busy flag; errors show the server's reason.
  const runAction = async (key: NonNullable<typeof busyAction>, fn: () => Promise<void>) => {
    setBusyAction(key);
    try {
      await fn();
    } catch (error: any) {
      console.error(`Worker action ${key} error:`, error);
      alertModal.error("Error", error?.message || "Something went wrong. Please try again.");
    } finally {
      setBusyAction(null);
      load(true);
    }
  };

  const handleCancelRequestAnswer = (accept: boolean) => {
    const run = () =>
      runAction(accept ? "agree" : "decline", async () => {
        await api.respondToCancelRequest(job.id, accept);
      });
    if (!accept) return run();
    alertModal.confirm("Cancel this job?", "No penalty for you or the client.", {
      confirmText: "Cancel Job",
      cancelText: "Keep Job",
      destructive: true,
      onConfirm: run,
    });
  };

  const handleClientNotHere = () =>
    runAction("notHere", async () => {
      // Not checked in yet (locked door): check in first, stop if that fails.
      if (!hasArrived && !(await checkIn())) return;
      const { canCancelAt } = await api.reportClientNotHere(job.id);
      alertModal.success(
        "Client alerted",
        canCancelAt
          ? `We alerted your client. You can cancel at ${timeOf(canCancelAt)} if they don't come.`
          : "We alerted your client. If they don't come, cancel the job with a photo as proof."
      );
    });

  const handleNoShowCancel = () => {
    const fee = job.clientFaultFeeAmount ?? 0;
    alertModal.confirm(fee > 0 ? `Cancel and charge the client the ₱${fee.toFixed(2)} no-show fee?` : "Cancel as a client no-show?", undefined, {
      confirmText: "Cancel Job",
      cancelText: "Keep Waiting",
      destructive: true,
      onConfirm: () =>
        runAction("noShowCancel", async () => {
          await api.cancelBooking(job.id, "Client was not home", undefined, { fault: "CLIENT", proofUrls: [] });
        }),
    });
  };

  const handleCashNotPaid = () => {
    alertModal.confirm("Tell HomeEase the client hasn't paid? An admin will follow up.", undefined, {
      confirmText: "Tell HomeEase",
      cancelText: "Not Yet",
      onConfirm: () =>
        runAction("notPaid", async () => {
          await api.reportCashNotPaid(job.id);
        }),
    });
  };

  const handleMessageClient = () => {
    router.push(`/(worker)/inbox/chat/${job.client.id}`);
  };

  const handleShareReceipt = () => {
    const lines = [
      `HomeEase — Job Receipt`,
      `Reference: ${job.id}`,
      `Service: ${job.service}`,
      `Client: ${job.client.fullName}`,
      `Date: ${formatJobDate(job.scheduledDate)}`,
      ``,
      `Subtotal: ₱${feeSubtotal.toFixed(2)}`,
      `Service fee: -₱${commissionEstimate.toFixed(2)}`,
      taxEstimate > 0 ? `Withholding tax: -₱${taxEstimate.toFixed(2)}` : null,
      tip > 0 ? `Tip (yours in full): +₱${tip.toFixed(2)}` : null,
      `Your payout: ₱${payoutEstimate.toFixed(2)}`,
    ].filter(Boolean);
    Share.share({ message: lines.join("\n") }).catch(() => {});
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Job Detail" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* Status */}
        <View className="items-center mb-4">
          <StatusBadge status={status as any} variant="booking" />
        </View>

        {/* Pending client-initiated reschedule request */}
        {hasPendingRescheduleRequest && (
          <View className="bg-accent/10 border border-accent/30 rounded-2xl p-4 mb-3">
            <View className="flex-row items-center">
              <Ionicons name="time" size={22} color={colors.accent.DEFAULT} />
              <Text className="font-bold text-sm text-text-primary ml-2 flex-1">
                Client requested a reschedule
              </Text>
            </View>
            <Text className="text-text-secondary text-xs mt-1.5">
              {job.client.fullName} asked to move this booking to {requestedWhen}.
            </Text>
            <View className="flex-row gap-2 mt-3">
              <View className="flex-1">
                <PrimaryButton
                  label="Accept"
                  fullWidth
                  disabled={respondingToReschedule}
                  loading={respondingToReschedule}
                  onPress={() => handleRespondToReschedule(true)}
                />
              </View>
              <View className="flex-1">
                <OutlinedButton
                  label="Decline"
                  fullWidth
                  disabled={respondingToReschedule}
                  onPress={() => handleRespondToReschedule(false)}
                />
              </View>
            </View>
          </View>
        )}

        {/* My own reschedule request, waiting on the client */}
        {iAskedToReschedule && (
          <View className="bg-accent/10 border border-accent/30 rounded-2xl p-4 mb-3">
            <Text className="font-bold text-sm text-text-primary">Reschedule request sent</Text>
            <Text className="text-text-secondary text-xs mt-1.5">
              Waiting for {job.client.fullName} to accept moving this job to {requestedWhen}. Until then, the original
              time stands.
            </Text>
            <View className="mt-3">
              <OutlinedButton label="Withdraw Request" onPress={handleWithdrawMyReschedule} />
            </View>
          </View>
        )}

        {/* Client asked to cancel */}
        {hasCancelRequest && (
          <View className="bg-accent/10 border border-accent/30 rounded-2xl p-4 mb-3">
            <Text className="font-bold text-sm text-text-primary">Your client wants to cancel</Text>
            {!!job.cancelRequestReason && (
              <Text className="text-text-secondary text-xs mt-1.5">{job.cancelRequestReason}</Text>
            )}
            <View className="flex-row gap-2 mt-3">
              <View className="flex-1">
                <PrimaryButton
                  label="Agree"
                  fullWidth
                  disabled={busyAction != null}
                  loading={busyAction === "agree"}
                  onPress={() => handleCancelRequestAnswer(true)}
                />
              </View>
              <View className="flex-1">
                <OutlinedButton
                  label="Decline"
                  fullWidth
                  disabled={busyAction != null}
                  loading={busyAction === "decline"}
                  onPress={() => handleCancelRequestAnswer(false)}
                />
              </View>
            </View>
          </View>
        )}

        {/* Job Info */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold text-lg">{job.service}</Text>
          <Text className="text-text-secondary text-sm mt-1">
            Client: {job.client.fullName}
          </Text>
          <Text className="text-text-muted text-xs mt-1">
            {new Date(job.scheduledDate).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
            {startTime ? ` · starts ${formatTime12h(startTime)}` : ""}
            {job.isRush ? " · Same-day" : ""}
          </Text>
          {!!job.parentBooking && (
            <Text className="text-accent text-xs mt-1">Follow-up to your {job.parentBooking.service}</Text>
          )}
          {upcomingVisits.map((visit) => (
            <View key={visit.id} className="flex-row items-center mt-2">
              <Ionicons name="repeat" size={14} color={colors.accent.DEFAULT} />
              <Text className="text-text-secondary text-xs ml-1.5 flex-1">
                Visit{" "}
                {new Date(visit.scheduledDate).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}{" "}
                at {formatTime12h(visit.scheduledTime)}
              </Text>
              <Text className="text-error text-xs font-semibold" onPress={() => handleCancelVisit(visit.id)}>
                Cancel
              </Text>
            </View>
          ))}
          <BookingAnswers quantity={job.quantity} unit={job.quantityUnit} answers={job.scopeAnswers} note={job.description} />
        </View>

        {!isInProgress && jobTime && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-secondary text-xs mb-1">Job time</Text>
            <Text className="text-text-primary font-semibold">{jobTime}</Text>
          </View>
        )}

        {/* Earnings */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-secondary text-xs mb-1">
            {isCompleted ? "Payout Amount" : "Your Estimated Earnings"}
          </Text>
          <Text className="text-success font-bold text-2xl">₱{payoutEstimate.toFixed(2)}</Text>
          <Text className="text-text-muted text-xs mt-1">
            Service ₱{feeSubtotal.toFixed(2)} − service fee ₱{commissionEstimate.toFixed(2)}
            {taxEstimate > 0 ? ` − tax ₱${taxEstimate.toFixed(2)}` : ""}
          </Text>
          {tip > 0 && (
            <View className="bg-gold/20 rounded-full self-start px-2.5 py-1 mt-2 flex-row items-center">
              <Text className="text-xs">🎉</Text>
              <Text className="text-accent text-xs font-bold ml-1">
                Includes a ₱{tip.toFixed(2)} tip — yours in full, no service fee
              </Text>
            </View>
          )}
        </View>

        {/* The invoice, once sent */}
        {invoiceSent && invoice && (
          <InvoiceCard invoice={invoice} />
        )}

        {/* Completion photo — shown once submitted */}
        {job.completionPhotoUrl && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold mb-2">
              Submitted Completion Photo
            </Text>
            <RemoteImage
              source={{ uri: job.completionPhotoUrl }}
              style={{ width: "100%", height: 180, borderRadius: 16 }}
              resizeMode="cover"
            />
          </View>
        )}

        {/* Client rating — once reviewed */}
        {isCompleted && job.review && (
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold mb-2">Client Rating</Text>
            <StarRating rating={job.review.rating} size={20} />
            {job.review.comment && (
              <Text className="text-text-secondary text-sm mt-2">&ldquo;{job.review.comment}&rdquo;</Text>
            )}
          </View>
        )}

        {/* No-show warning: the job is cancelled with a penalty if the worker never checks in */}
        {isAccepted && !hasArrived && startPassed && (
          <View className="bg-warning/10 border border-warning/30 rounded-2xl p-4 mb-3 flex-row items-center">
            <Ionicons name="alert-circle" size={24} color={colors.warning} />
            <View className="ml-3 flex-1">
              <Text className="text-warning font-bold text-sm">
                You haven&apos;t checked in
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                If you don&apos;t check in within {graceMinutes} minutes of the start time, this job is
                cancelled and a ₱{NO_SHOW_PENALTY} penalty is added to your dues.
              </Text>
            </View>
          </View>
        )}
        {job.workerNoShowFlaggedAt && status === "Cancelled" && (
          <View className="bg-error/10 border border-error/30 rounded-2xl p-4 mb-3">
            <Text className="text-error font-bold text-sm">Cancelled: no-show</Text>
            <Text className="text-text-secondary text-xs mt-0.5">
              You didn&apos;t check in on time, so this job was cancelled and the penalty was added to your dues.
            </Text>
          </View>
        )}

        {/* Progress Stepper */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold mb-3">Job Progress</Text>
          <StepperVertical steps={steps} />
        </View>

        {/* Actions */}
        <View className="gap-3 mt-4">
          {canRequestReschedule && (
            <OutlinedButton
              label="Request Reschedule"
              onPress={() => router.push(`/(worker)/records/reschedule/${job.id}`)}
            />
          )}
          {shouldShareLocation && (
            <View className="flex-row items-center justify-center bg-success/10 rounded-xl py-2 -mt-1">
              <Ionicons name="navigate-circle" size={16} color={colors.success} />
              <Text className="text-success text-xs font-semibold ml-2">
                Sharing your live location with the client
              </Text>
            </View>
          )}
          {canStartNow && (
            <View>
              <PrimaryButton
                label={hasArrived ? "Start Job" : "I've Arrived, Start Job"}
                fullWidth
                onPress={handleStart}
                disabled={submitting || busyAction != null}
                loading={submitting}
              />
              {!hasArrived && (
                <Text className="text-text-muted text-xs text-center mt-2">
                  Be within 100 m of the job site. Your location is checked when you start.
                </Text>
              )}
            </View>
          )}
          {isAccepted && (hasArrived || (startPassed && !pastGrace)) && !job.clientNotHereAt && (
            <OutlinedButton
              label="Client not here"
              fullWidth
              disabled={busyAction != null || submitting}
              loading={busyAction === "notHere"}
              onPress={handleClientNotHere}
            />
          )}
          {waitingForClient && !noShowCancelOpen && (
            <Text className="text-text-secondary text-xs text-center">
              Waiting for the client until {timeOf(job.clientNoShowCancelAt!)}
            </Text>
          )}
          {noShowCancelOpen && (
            <PrimaryButton
              label="Cancel: client no-show"
              fullWidth
              disabled={busyAction != null}
              loading={busyAction === "noShowCancel"}
              onPress={handleNoShowCancel}
            />
          )}
          {canScheduleVisit && (
            <OutlinedButton
              label="Schedule Follow-up Visit"
              fullWidth
              onPress={() => router.push(`/(worker)/records/visit/${job.id}`)}
            />
          )}
          {isDisputed && (
            <View className="bg-error/10 border border-error rounded-2xl p-4 items-center">
              <Text className="text-error font-semibold">
                {invoice?.status === "REPORTED" ? "The client reported your invoice." : "This job is under review."}
              </Text>
              <Text className="text-text-secondary text-xs mt-1 text-center">
                HomeEase will review it and tell you the outcome. Don&apos;t collect payment until then.
              </Text>
            </View>
          )}
          {isInProgress && (
            <View className="gap-3">
              <View className="bg-card rounded-2xl p-4">
                <Text className="text-text-primary font-bold mb-1">Before you begin</Text>
                <Text className="text-text-muted text-xs mb-3">
                  Take a photo of the area or item as you found it. The client sees it.
                </Text>
                {job.beforePhotoUrls?.length ? (
                  <View className="flex-row flex-wrap gap-2">
                    {job.beforePhotoUrls.map((url) => (
                      <RemoteImage key={url} source={{ uri: url }} className="w-16 h-16 rounded-lg bg-card-dark" />
                    ))}
                  </View>
                ) : (
                  <>
                    <ProofPhotosField
                      bookingId={job.id}
                      label="Photo of the job before you start"
                      urls={beforeDraft}
                      onChange={setBeforeDraft}
                      required
                    />
                    {beforeDraft.length > 0 && (
                      <PrimaryButton
                        label="Save Photo"
                        fullWidth
                        onPress={handlePostBefore}
                        disabled={postingBefore}
                        loading={postingBefore}
                      />
                    )}
                  </>
                )}
              </View>
              <View className="bg-card rounded-2xl p-4">
                <Text className="text-text-primary font-bold mb-1">Progress updates</Text>
                <Text className="text-text-muted text-xs mb-3">
                  Post at least one photo while you work. The client sees these.
                </Text>
                {!!job.progressPhotoUrls?.length && (
                  <View className="flex-row flex-wrap gap-2 mb-3">
                    {job.progressPhotoUrls.map((url) => (
                      <RemoteImage key={url} source={{ uri: url }} className="w-16 h-16 rounded-lg bg-card-dark" />
                    ))}
                  </View>
                )}
                <ProofPhotosField
                  bookingId={job.id}
                  label="New progress photo"
                  urls={progressDraft}
                  onChange={setProgressDraft}
                />
                {progressDraft.length > 0 && (
                  <PrimaryButton
                    label="Post Update"
                    fullWidth
                    onPress={handlePostProgress}
                    disabled={postingProgress}
                    loading={postingProgress}
                  />
                )}
              </View>
              {/* The invoice: the booked job, then anything added here */}
              <View className="bg-card rounded-2xl p-4">
                <Text className="text-text-primary font-bold mb-1">Invoice</Text>
                <Text className="text-text-muted text-xs mb-3">
                  Add any parts you bought or extra work you did. The client sees every line and pays the total.
                </Text>
                <View className="flex-row justify-between mb-2">
                  <Text className="text-text-primary text-sm flex-1 pr-2">{job.service}</Text>
                  <Text className="text-text-primary text-sm font-semibold">
                    ₱{(job.estimatedPrice).toFixed(2)}
                  </Text>
                </View>
                {bookedPackages.map((pkg) => (
                  <View key={pkg.id} className="flex-row justify-between mb-2">
                    <Text className="text-text-secondary text-sm flex-1 pr-2">{pkg.name}</Text>
                    <Text className="text-text-primary text-sm">₱{pkg.price.toFixed(2)}</Text>
                  </View>
                ))}
                {invoiceItems.map((item, index) => (
                  <View key={`${item.name}-${index}`} className="flex-row items-center justify-between mb-2">
                    <Text className="text-text-secondary text-sm flex-1 pr-2">
                      {item.name} · {item.kind === "PART" ? "Part" : "Extra work"}
                    </Text>
                    <Text className="text-text-primary text-sm mr-3">₱{item.price.toFixed(2)}</Text>
                    <Text
                      className="text-error text-xs font-semibold"
                      onPress={() => setInvoiceItems((items) => items.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Text>
                  </View>
                ))}
                {tip > 0 && (
                  <View className="flex-row justify-between mb-2">
                    <Text className="text-text-secondary text-sm">Tip</Text>
                    <Text className="text-text-primary text-sm">₱{tip.toFixed(2)}</Text>
                  </View>
                )}
                <View className="border-t border-divider pt-2 mt-1 flex-row justify-between">
                  <Text className="text-text-primary font-bold">Total</Text>
                  <Text className="text-text-primary font-bold">₱{draftInvoiceTotal.toFixed(2)}</Text>
                </View>
                <View className="flex-row gap-2 mt-3">
                  <View className="flex-1">
                    <OutlinedButton label="Add a Part" fullWidth onPress={() => setLineModalKind("PART")} />
                  </View>
                  <View className="flex-1">
                    <OutlinedButton label="Add Extra Work" fullWidth onPress={() => setLineModalKind("EXTRA_WORK")} />
                  </View>
                </View>
              </View>
              {completionPhotoUri ? (
                <View>
                  <Image
                    source={{ uri: completionPhotoUri }}
                    style={{ width: "100%", height: 180, borderRadius: 16 }}
                    resizeMode="cover"
                  />
                  <PrimaryButton
                    label={uploadingPhoto ? "Uploading..." : "Change Photo"}
                    fullWidth
                    onPress={() => photoSheetRef.current?.expand()}
                    disabled={uploadingPhoto}
                  />
                </View>
              ) : (
                <UploadCard
                  label="Attach photo of completed work"
                  subtitle="Required before you can mark this job complete"
                  required
                  onPress={() => photoSheetRef.current?.expand()}
                />
              )}
              <PrimaryButton
                label="Send Invoice"
                fullWidth
                onPress={handleSendInvoice}
                disabled={
                  submitting || uploadingPhoto || !completionPhotoUrl || !job.beforePhotoUrls?.length || !job.progressPhotoUrls?.length
                }
                loading={submitting}
              />
              {!job.beforePhotoUrls?.length ? (
                <Text className="text-text-muted text-xs text-center">Save a before photo first.</Text>
              ) : !job.progressPhotoUrls?.length ? (
                <Text className="text-text-muted text-xs text-center">Post a progress update first.</Text>
              ) : null}
            </View>
          )}
          {isPendingCompletion && isCash && (
            <View className="gap-2">
              <PrimaryButton
                label={`Cash Received · ₱${(invoice?.total ?? amount + tip).toFixed(2)}`}
                fullWidth
                onPress={handleCashReceived}
                disabled={confirmingCash}
                loading={confirmingCash}
              />
              <Text className="text-text-muted text-xs text-center">
                Tap once the client has paid you. If you don&apos;t, it&apos;s recorded as paid after 3 days.
              </Text>
              <Text
                className={`text-error text-xs font-semibold text-center py-1 ${busyAction ? "opacity-40" : ""}`}
                onPress={busyAction ? undefined : handleCashNotPaid}
              >
                Client didn&apos;t pay
              </Text>
            </View>
          )}
          {isPendingCompletion && !isCash && (
            <View className="bg-accent/10 border border-accent rounded-2xl p-4 items-center">
              <Text className="text-accent font-semibold">Waiting for the client&apos;s payment.</Text>
            </View>
          )}
          {isAwaitingPayment && (
            <View className="bg-warning/10 border border-warning rounded-2xl p-4 items-center">
              <Text className="text-warning font-semibold">
                Waiting for the client&apos;s {job.paymentMethodType === "MAYA" ? "Maya" : "GCash"} payment.
              </Text>
              <Text className="text-text-secondary text-xs mt-1">
                Your payout is released once payment is received.
              </Text>
            </View>
          )}
          {isCompleted && (
            <View className="gap-3">
              <View className="bg-success/10 border border-success rounded-2xl p-4 items-center">
                <Text className="text-success font-semibold">
                  This job has been completed.
                </Text>
                <Text className="text-text-secondary text-xs mt-1">
                  {job.payment?.escrowStatus === "RELEASED"
                    ? "Payment has been released to your account."
                    : "Payment is being processed."}
                </Text>
              </View>
              <OutlinedButton label="Share Receipt" onPress={handleShareReceipt} />
            </View>
          )}
          <OutlinedButton
            label="Message Client"
            onPress={handleMessageClient}
          />
          {canCancelJob && (
            <DangerButton
              label="Cancel Job"
              fullWidth
              onPress={() => router.push(`/(worker)/records/cancel/${job.id}`)}
            />
          )}
        </View>
      </ScrollView>
      <InvoiceLineModal
        key={lineModalKind ?? "closed"}
        visible={lineModalKind != null}
        bookingId={job.id}
        kind={lineModalKind ?? "PART"}
        onConfirm={(item) => {
          setInvoiceItems((items) => [...items, item]);
          setLineModalKind(null);
        }}
        onCancel={() => setLineModalKind(null)}
      />
      <ImageSourcePickerBottomSheet
        innerRef={photoSheetRef}
        onSelect={handleSelectCompletionPhoto}
      />
    </SafeAreaView>
  );
}
