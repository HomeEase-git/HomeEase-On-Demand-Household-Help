import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Image, ScrollView, Share } from "react-native";
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
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { API_STATUS_MAP } from "../../../../store/bookingStore";
import * as api from "../../../../services/api";
import { getCurrentPosition, LocationPermissionDeniedError } from "../../../../services/location";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import { usePolling } from "../../../../hooks/usePolling";

// A real-time socket layer already pushes updates here — this poll is a
// belt-and-suspenders fallback, not the primary refresh path.
const POLL_INTERVAL_MS = 25000;

type BookingDetail = {
  id: string;
  client: { fullName: string; phone?: string | null };
  service: string;
  status: string;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
  tip?: number | null;
  completionPhotoUrl?: string | null;
  workerArrivedAt?: string | null;
  timeline?: { workerArrivedAt?: string | null; workerStartedAt?: string | null } | null;
  review?: { rating: number; comment: string | null } | null;
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

export default function JobDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [job, setJob] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [completionPhotoUri, setCompletionPhotoUri] = useState<string | null>(null);
  const [completionPhotoUrl, setCompletionPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
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
  // Matches the backend's ADDON_ALLOWED_STATUSES (bookingController.addAddon).
  const canAddAddon = isInProgress || isQuoteSubmitted || isQuoteApproved;
  const canCancelJob = isAccepted || isInProgress || isQuoteSubmitted || isQuoteApproved || isDisputed;

  // Prefer the real settled amounts off the Payment row once one exists;
  // fall back to a rough 10%-commission estimate for jobs still pre-payout.
  // Tip is never commissioned or taxed (see utils/pricing.ts
  // calculateWorkerPayout) so it's added on top, not folded into the 90%.
  const payoutEstimate = job.payment?.workerPayout ?? amount * 0.9 + tip;
  const commissionEstimate = job.payment?.commissionAmount ?? amount * 0.1;
  const taxEstimate = job.payment?.withholdingTaxAmount ?? 0;

  const steps = [
    { label: "Accepted", timestamp: job.scheduledDate, status: "done" as const },
    {
      label: "Arrived",
      timestamp: "",
      status: hasArrived ? ("done" as const) : isAccepted ? ("active" as const) : ("pending" as const),
    },
    {
      label: "In Progress",
      timestamp: "",
      status:
        isQuoteApproved ||
        isPendingCompletion ||
        isAwaitingPayment ||
        isCompleted ||
        isQuoteSubmitted ||
        isDisputed
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
      await api.arriveBooking(job.id, position.lat, position.lng);
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
      await api.startBooking(job.id);
      alertModal.success("Job Started", "You've started this job.");
      load();
    } catch (error) {
      console.error("Start booking error:", error);
      alertModal.error("Error", "Failed to start this job. Please try again.");
    } finally {
      setSubmitting(false);
    }
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
      "Confirm that you have finished this job. The client will review your photo and confirm completion before payment is released.",
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

  const handleMessageClient = () => {
    router.push("/(worker)/inbox");
  };

  const handleShareReceipt = () => {
    const lines = [
      `HomeEase — Job Receipt`,
      `Reference: ${job.id}`,
      `Service: ${job.service}`,
      `Client: ${job.client.fullName}`,
      `Date: ${job.scheduledDate}`,
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

        {/* Job Info */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold text-lg">{job.service}</Text>
          <Text className="text-text-secondary text-sm mt-1">
            Client: {job.client.fullName}
          </Text>
          <Text className="text-text-muted text-xs mt-1">Date: {job.scheduledDate}</Text>
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

        {/* Earnings */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-secondary text-xs mb-1">
            {isCompleted ? "Payout Amount" : "Your Estimated Earnings"}
          </Text>
          <Text className="text-success font-bold text-2xl">₱{payoutEstimate.toFixed(2)}</Text>
          <Text className="text-text-muted text-xs mt-1">
            Labor ₱{(job.payment?.subtotal ?? amount).toFixed(2)} − commission ₱{commissionEstimate.toFixed(2)}
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
            <Image
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

        {/* Progress Stepper */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold mb-3">Job Progress</Text>
          <StepperVertical steps={steps} />
        </View>

        {/* Actions */}
        <View className="gap-3 mt-4">
          {canAddAddon && (
            <OutlinedButton
              label="+ Add Item"
              onPress={() => router.push(`/(worker)/requests/addon/${job.id}`)}
            />
          )}
          {isAccepted && !hasArrived && (
            <PrimaryButton
              label="I've Arrived"
              fullWidth
              onPress={handleArrive}
              disabled={arriving}
              loading={arriving}
            />
          )}
          {isAccepted && hasArrived && (
            <PrimaryButton
              label="Start Job"
              fullWidth
              onPress={handleStart}
              disabled={submitting}
              loading={submitting}
            />
          )}
          {isAccepted && !hasArrived && (
            <Text className="text-text-muted text-xs text-center -mt-1">
              You must check in within 100m of the job site before starting.
            </Text>
          )}
          {isInProgress && (
            <PrimaryButton
              label="Submit Quote"
              fullWidth
              onPress={() => router.push(`/(worker)/requests/quote/${job.id}`)}
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
            <View className="gap-3">
              <View className="bg-error/10 border border-error rounded-2xl p-4 items-center">
                <Text className="text-error font-semibold">
                  The client disputed your quote.
                </Text>
              </View>
              <OutlinedButton
                label="Revise Quote"
                onPress={() => router.push(`/(worker)/requests/quote/${job.id}`)}
              />
            </View>
          )}
          {isQuoteApproved && (
            <View className="gap-3">
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
                disabled={submitting || uploadingPhoto || !completionPhotoUrl}
                loading={submitting}
              />
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
              onPress={() => router.push(`/(worker)/requests/cancel/${job.id}`)}
            />
          )}
        </View>
      </ScrollView>
      <ImageSourcePickerBottomSheet
        innerRef={photoSheetRef}
        onSelect={handleSelectCompletionPhoto}
      />
    </SafeAreaView>
  );
}
