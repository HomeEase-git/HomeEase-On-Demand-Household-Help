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
import AddExtraWorkModal from "../../../../components/modals/AddExtraWorkModal";
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
  addOns?: { id: string; name: string; price: number; clientApprovedAt: string | null; clientRejectedAt: string | null }[];
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
  quote?: { status?: string | null; rejectionReason?: string | null; revision?: number } | null;
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
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Dates arrive as UTC-midnight ISO strings; show them as "Oct 18, 2026".
const formatJobDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

export default function JobDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [job, setJob] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [respondingToReschedule, setRespondingToReschedule] = useState(false);
  const [completionPhotoUri, setCompletionPhotoUri] = useState<string | null>(null);
  const [completionPhotoUrl, setCompletionPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Proof photos: before (needed to start) and progress (needed to finish).
  const [beforePhotoUrls, setBeforePhotoUrls] = useState<string[]>([]);
  const [progressDraft, setProgressDraft] = useState<string[]>([]);
  const [postingProgress, setPostingProgress] = useState(false);
  const [addExtraVisible, setAddExtraVisible] = useState(false);
  const [addingExtra, setAddingExtra] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
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

  const workerStartedAt = job?.timeline?.workerStartedAt;
  useEffect(() => {
    if (!workerStartedAt) return;
    const startedAt = new Date(workerStartedAt).getTime();
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [workerStartedAt]);
  const displayedElapsedMs = workerStartedAt ? elapsedMs : 0;
  const jobTime = formatJobTime(workerStartedAt, job?.timeline?.workerCompletedAt);

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
  const isQuoteSubmitted = status === "QuoteSubmitted";
  const isQuoteApproved = status === "QuoteApproved";
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
  // Items live in the quote; a submitted or approved quote is reopened to edit
  // them (bookingController.reopenQuote) and the client approves the new total.
  const canEditQuote = isQuoteSubmitted || isQuoteApproved;
  // Same window the backend allows (bookingController.canAddExtraWork).
  const canAddExtra = (isAccepted && hasArrived) || isQuoteSubmitted || isQuoteApproved || isInProgress;
  const canCancelJob = isAccepted || isInProgress || isQuoteSubmitted || isQuoteApproved || isDisputed;
  const hasOpenRescheduleRequest = !!job.rescheduleRequestedAt && !job.rescheduleRequestRespondedAt;
  // The client asked (or an older request from before either side could ask).
  const hasPendingRescheduleRequest = hasOpenRescheduleRequest && job.rescheduleRequestedBy !== "WORKER";
  const iAskedToReschedule = hasOpenRescheduleRequest && job.rescheduleRequestedBy === "WORKER";
  const canRequestReschedule = isAccepted && !hasArrived && !hasOpenRescheduleRequest;
  // Work under way — another visit can be planned for a job that needs more days.
  const canScheduleVisit = isInProgress || isQuoteSubmitted || isQuoteApproved;
  // A refused (or reopened) quote returns the job to Accepted, where it is revised.
  const quoteRefused = isAccepted && job.quote?.status === "REJECTED";
  const startTime = bookingStartTime(job);
  const startsAt = startTime ? startInstant(job.scheduledDate.slice(0, 10), startTime) : null;
  const startPassed = !!startsAt && now >= startsAt.getTime();
  const upcomingVisits = (job.visits ?? []).filter((v) => v.status === "SCHEDULED");
  const requestedWhen = job.requestedScheduledDate
    ? `${new Date(job.requestedScheduledDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: "UTC" })}${
        job.requestedScheduledTime ? ` at ${formatTime12h(job.requestedScheduledTime)}` : ""
      }`
    : "a new date"

  // Prefer the real settled amounts off the Payment row once one exists;
  // fall back to a rough 10%-commission estimate for jobs still pre-payout.
  // Tip is never commissioned or taxed (see utils/pricing.ts
  // calculateWorkerPayout) so it's added on top, not folded into the 90%.
  const payoutEstimate = job.payment?.workerPayout ?? amount * 0.9 + tip;
  const commissionEstimate = job.payment?.commissionAmount ?? amount * 0.1;
  const taxEstimate = job.payment?.withholdingTaxAmount ?? 0;

  const steps = [
    { label: "Accepted", timestamp: formatJobDate(job.scheduledDate), status: "done" as const },
    {
      label: "Arrived",
      timestamp: "",
      status: hasArrived ? ("done" as const) : isAccepted ? ("active" as const) : ("pending" as const),
    },
    // The quote comes right after arriving, before the job starts.
    {
      label: "Quote",
      timestamp: "",
      status:
        isQuoteApproved || isInProgress || isPendingCompletion || isAwaitingPayment || isCompleted
          ? ("done" as const)
          : hasArrived && (isAccepted || isQuoteSubmitted || isDisputed)
            ? ("active" as const)
            : ("pending" as const),
    },
    {
      label: "In Progress",
      timestamp: "",
      status:
        isPendingCompletion || isAwaitingPayment || isCompleted
          ? ("done" as const)
          : isInProgress
            ? ("active" as const)
            : ("pending" as const),
    },
    {
      label: "Completed",
      timestamp: "",
      status: isCompleted
        ? ("done" as const)
        : isPendingCompletion || isAwaitingPayment
          ? ("active" as const)
          : ("pending" as const),
    },
  ];

  const handleArrive = async () => {
    setArriving(true);
    try {
      const position = await getCurrentPosition();
      await api.arriveBooking(job.id, position.lat, position.lng, position.accuracy, position.mocked);
      alertModal.success("Arrival confirmed", "You're checked in at the job site.");
      load();
    } catch (error) {
      if (error instanceof LocationPermissionDeniedError) {
        alertModal.error("Location needed", "Please enable location access to check in at the job site.");
      } else {
        const message = error instanceof Error ? error.message : "Failed to verify your arrival.";
        alertModal.error("Can't check in yet", message);
      }
    } finally {
      setArriving(false);
    }
  };

  const handleStart = async () => {
    setSubmitting(true);
    try {
      await api.startBooking(job.id, beforePhotoUrls);
      setBeforePhotoUrls([]);
      alertModal.success(
        "Job Started",
        "Post at least one progress photo while you work, then mark it complete with a photo of the finished job.",
      );
      load();
    } catch (error) {
      console.error("Start booking error:", error);
      // Show the server's reason (no before photo, quote not approved yet…);
      // the generic text hid what the worker needs to do.
      const message = error instanceof Error && error.message ? error.message : "Failed to start this job. Please try again.";
      alertModal.error("Can't start this job", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddExtra = async (name: string, price: number) => {
    setAddingExtra(true);
    try {
      await api.addBookingAddOn(job.id, name, price);
      setAddExtraVisible(false);
      alertModal.success("Sent to client", "It's added to the bill once the client approves it.");
      load(true);
    } catch (error: any) {
      console.error("Add extra work error:", error);
      alertModal.error("Error", error?.message || "Failed to add the extra work. Please try again.");
    } finally {
      setAddingExtra(false);
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

  const handleMarkComplete = () => {
    if (!completionPhotoUrl) return;
    alertModal.confirm(
      "Mark as Complete?",
      "Confirm you've finished this job. The client will review your photo and confirm completion.",
      {
        confirmText: "Confirm",
        cancelText: "Cancel",
        onConfirm: async () => {
          setSubmitting(true);
          try {
            await api.completeBooking(job.id, completionPhotoUrl);
            alertModal.success(
              "Submitted!",
              "The client will review your photo and confirm completion.",
              [{ text: "OK", onPress: () => router.back() }],
            );
          } catch (error) {
            console.error("Complete booking error:", error);
            alertModal.error("Error", "Failed to complete this job. Please try again.");
          } finally {
            setSubmitting(false);
          }
        },
      },
    );
  };

  const handleEditQuote = () => {
    alertModal.confirm(
      "Edit this quote?",
      "The client will need to approve the new total after you resubmit.",
      {
        confirmText: "Edit Quote",
        onConfirm: async () => {
          try {
            await api.reopenQuote(job.id);
            router.push(`/(worker)/records/quote/${job.id}`);
          } catch (error) {
            console.error("Reopen quote error:", error);
            alertModal.error("Error", "Failed to reopen the quote. Please try again.");
          }
        },
      },
    );
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
      `Subtotal: ₱${(job.payment?.subtotal ?? amount).toFixed(2)}`,
      `Commission: -₱${commissionEstimate.toFixed(2)}`,
      taxEstimate > 0 ? `Withholding tax: -₱${taxEstimate.toFixed(2)}` : null,
      tip > 0 ? `Tip (yours, untaxed): +₱${tip.toFixed(2)}` : null,
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
          <StatusBadge status={status as any} />
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

        {/* The client refused the quote */}
        {quoteRefused && (
          <View className="bg-error/10 border border-error/30 rounded-2xl p-4 mb-3">
            <Text className="text-error font-bold text-sm">The client refused your quote</Text>
            {!!job.quote?.rejectionReason && (
              <Text className="text-text-secondary text-xs mt-1.5">&ldquo;{job.quote.rejectionReason}&rdquo;</Text>
            )}
            <Text className="text-text-muted text-xs mt-1.5">
              Fix the quote so it matches your receipt, then submit it again.
            </Text>
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
        </View>

        {/* Live working timer */}
        {isInProgress && (
          <View className="bg-brand rounded-2xl p-4 mb-3 items-center">
            <Text className="text-white/70 text-xs font-medium">Time on job</Text>
            <Text className="text-white font-bold text-3xl mt-1" style={{ fontVariant: ["tabular-nums"] }}>
              {formatElapsed(displayedElapsedMs)}
            </Text>
          </View>
        )}
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
            Service ₱{(job.payment?.subtotal ?? amount).toFixed(2)} − commission ₱{commissionEstimate.toFixed(2)}
            {taxEstimate > 0 ? ` − tax ₱${taxEstimate.toFixed(2)}` : ""}
          </Text>
          {tip > 0 && (
            <View className="bg-gold/20 rounded-full self-start px-2.5 py-1 mt-2 flex-row items-center">
              <Text className="text-xs">🎉</Text>
              <Text className="text-accent text-xs font-bold ml-1">
                Includes a ₱{tip.toFixed(2)} tip — yours in full, no commission or tax
              </Text>
            </View>
          )}
        </View>

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
                If you don&apos;t check in within {NO_SHOW_GRACE_MINUTES} minutes of the start time, this job is
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
          {isAccepted && !hasArrived && (
            <PrimaryButton
              label="I've Arrived"
              fullWidth
              onPress={handleArrive}
              disabled={arriving}
              loading={arriving}
            />
          )}
          {/* Arrived: assess the job, then send the quote — the job starts once the client approves it. */}
          {isAccepted && hasArrived && (
            <>
              <PrimaryButton
                label={quoteRefused ? "Revise Quote" : "Send Quote"}
                fullWidth
                onPress={() => router.push(`/(worker)/records/quote/${job.id}`)}
              />
              <Text className="text-text-muted text-xs text-center -mt-1">
                The client reviews your quote first. You can start the job once they approve it.
              </Text>
            </>
          )}
          {isAccepted && !hasArrived && (
            <Text className="text-text-muted text-xs text-center -mt-1">
              Check in within 100 m of the job site, then send your quote.
            </Text>
          )}
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
          {isQuoteApproved && (
            <View>
              <ProofPhotosField
                bookingId={job.id}
                label="Photos of the job before you start"
                hint="Required. Show the area or item as you found it."
                urls={beforePhotoUrls}
                onChange={setBeforePhotoUrls}
                required
              />
              <PrimaryButton
                label="Start Job"
                fullWidth
                onPress={handleStart}
                disabled={submitting || beforePhotoUrls.length === 0}
                loading={submitting}
              />
            </View>
          )}
          {canEditQuote && <OutlinedButton label="Edit Quote" fullWidth onPress={handleEditQuote} />}
          {!!job.addOns?.length && (
            <View className="bg-card rounded-2xl p-4">
              <Text className="text-text-primary font-bold mb-2">Extra work</Text>
              {job.addOns.map((a) => (
                <View key={a.id} className="flex-row justify-between py-1">
                  <Text className="text-text-secondary text-sm flex-1">
                    {a.name} · ₱{a.price}
                  </Text>
                  <Text
                    className={`text-xs font-semibold ${a.clientApprovedAt ? "text-success" : a.clientRejectedAt ? "text-error" : "text-warning"}`}
                  >
                    {a.clientApprovedAt ? "Approved" : a.clientRejectedAt ? "Declined" : "Waiting for client"}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {canAddExtra && <OutlinedButton label="Add Extra Work" fullWidth onPress={() => setAddExtraVisible(true)} />}
          {canScheduleVisit && (
            <OutlinedButton
              label="Schedule Follow-up Visit"
              fullWidth
              onPress={() => router.push(`/(worker)/records/visit/${job.id}`)}
            />
          )}
          {isQuoteSubmitted && (
            <View className="bg-accent/10 border border-accent rounded-2xl p-4 items-center">
              <Text className="text-accent font-semibold">
                Quote submitted. Waiting for client approval.
              </Text>
            </View>
          )}
          {isDisputed && (
            <View className="bg-error/10 border border-error rounded-2xl p-4 items-center">
              <Text className="text-error font-semibold">The client disputed your quote.</Text>
              <Text className="text-text-secondary text-xs mt-1 text-center">
                HomeEase support will review it and may ask you to submit a new quote.
              </Text>
            </View>
          )}
          {isInProgress && (
            <View className="gap-3">
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
                label="Complete Job"
                fullWidth
                onPress={handleMarkComplete}
                disabled={submitting || uploadingPhoto || !completionPhotoUrl || !job.progressPhotoUrls?.length}
                loading={submitting}
              />
              {!job.progressPhotoUrls?.length && (
                <Text className="text-text-muted text-xs text-center">Post a progress update first.</Text>
              )}
            </View>
          )}
          {isPendingCompletion && (
            <View className="bg-accent/10 border border-accent rounded-2xl p-4 items-center">
              <Text className="text-accent font-semibold">
                Waiting for the client to review your photo, confirm completion, and pay.
              </Text>
            </View>
          )}
          {isAwaitingPayment && (
            <View className="bg-warning/10 border border-warning rounded-2xl p-4 items-center">
              <Text className="text-warning font-semibold">
                The client confirmed the job — waiting for their payment to clear.
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
      <AddExtraWorkModal
        visible={addExtraVisible}
        loading={addingExtra}
        onConfirm={handleAddExtra}
        onCancel={() => setAddExtraVisible(false)}
      />
      <ImageSourcePickerBottomSheet
        innerRef={photoSheetRef}
        onSelect={handleSelectCompletionPhoto}
      />
    </SafeAreaView>
  );
}
