import React, { useCallback, useRef, useState } from "react";
import { View, Text, Image, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import StepperVertical from "../../../../components/steppers/StepperVertical";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import UploadCard from "../../../../components/ui/UploadCard";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import { Skeleton } from "../../../../components/ui/Skeleton";
import { API_STATUS_MAP } from "../../../../store/bookingStore";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

type BookingDetail = {
  id: string;
  client: { fullName: string };
  service: string;
  status: string;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
  completionPhotoUrl?: string | null;
};

export default function JobDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [job, setJob] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completionPhotoUri, setCompletionPhotoUri] = useState<string | null>(null);
  const [completionPhotoUrl, setCompletionPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoSheetRef = useRef<BottomSheetHandle | null>(null);
  const alertModal = useAlertModal();

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const detail = await api.getBookingDetail(jobId);
      setJob(detail);
    } catch (error) {
      console.error("Load job detail error:", error);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
          <View className="bg-card rounded-2xl p-4 mb-3">
            <Skeleton width="40%" height={14} marginBottom={12} />
            <Skeleton width="100%" height={12} marginBottom={8} />
            <Skeleton width="100%" height={12} marginBottom={8} />
            <Skeleton width="100%" height={12} marginBottom={0} />
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
  const isCompleted = status === "Completed";
  const amount = job.finalPrice ?? job.estimatedPrice;

  const steps = [
    { label: "Accepted", timestamp: job.scheduledDate, status: "done" as const },
    {
      label: "In Progress",
      timestamp: "",
      status: isAccepted ? ("active" as const) : ("done" as const),
    },
    {
      label: "Quote Approved",
      timestamp: "",
      status:
        isQuoteApproved || isPendingCompletion || isCompleted
          ? ("done" as const)
          : isInProgress || isQuoteSubmitted || isDisputed
            ? ("active" as const)
            : ("pending" as const),
    },
    {
      label: "Completed",
      timestamp: "",
      status: isCompleted
        ? ("done" as const)
        : isPendingCompletion
          ? ("active" as const)
          : ("pending" as const),
    },
  ];

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

        {/* Earnings */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-secondary text-xs mb-1">
            Your Earnings
          </Text>
          <Text className="text-success font-bold text-2xl">
            ₱{(amount * 0.9).toFixed(2)}
          </Text>
          <Text className="text-text-muted text-xs mt-1">
            After 10% platform fee from ₱{amount}.00
          </Text>
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

        {/* Progress Stepper */}
        <View className="bg-card rounded-2xl p-4 mb-3">
          <Text className="text-text-primary font-bold mb-3">Job Progress</Text>
          <StepperVertical steps={steps} />
        </View>

        {/* Actions */}
        <View className="gap-3 mt-4">
          {isAccepted && (
            <PrimaryButton
              label="Start Job"
              fullWidth
              onPress={handleStart}
              disabled={submitting}
              loading={submitting}
            />
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
                Waiting for the client to review your photo and confirm completion.
              </Text>
            </View>
          )}
          {isCompleted && (
            <View className="bg-success/10 border border-success rounded-2xl p-4 items-center">
              <Text className="text-success font-semibold">
                This job has been completed.
              </Text>
              <Text className="text-text-secondary text-xs mt-1">
                Payment will be released to your account.
              </Text>
            </View>
          )}
          <OutlinedButton
            label="Message Client"
            onPress={handleMessageClient}
          />
        </View>
      </ScrollView>
      <ImageSourcePickerBottomSheet
        innerRef={photoSheetRef}
        onSelect={handleSelectCompletionPhoto}
      />
    </SafeAreaView>
  );
}
