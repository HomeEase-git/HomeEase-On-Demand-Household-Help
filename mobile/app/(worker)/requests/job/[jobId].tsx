import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import StatusBadge from "../../../../components/ui/StatusBadge";
import StepperVertical from "../../../../components/steppers/StepperVertical";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { API_STATUS_MAP } from "../../../../store/bookingStore";
import * as api from "../../../../services/api";

type BookingDetail = {
  id: string;
  client: { fullName: string };
  service: string;
  status: string;
  scheduledDate: string;
  estimatedPrice: number;
  finalPrice: number | null;
};

export default function JobDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [job, setJob] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

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
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" />
        </View>
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
      status: isQuoteApproved || isCompleted ? ("done" as const) : isInProgress || isQuoteSubmitted || isDisputed ? ("active" as const) : ("pending" as const),
    },
    {
      label: "Completed",
      timestamp: "",
      status: isCompleted ? ("done" as const) : ("pending" as const),
    },
  ];

  const handleStart = async () => {
    setSubmitting(true);
    try {
      await api.startBooking(job.id);
      Alert.alert("Job Started", "You've started this job.");
      load();
    } catch (error) {
      console.error("Start booking error:", error);
      Alert.alert("Error", "Failed to start this job. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkComplete = () => {
    Alert.alert(
      "Mark as Complete?",
      "Confirm that you have finished this job. The client will be notified.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async () => {
            setSubmitting(true);
            try {
              await api.completeBooking(job.id);
              Alert.alert(
                "Job Completed!",
                "Great work! The client has been notified and payment will be released.",
                [{ text: "OK", onPress: () => router.back() }],
              );
            } catch (error) {
              console.error("Complete booking error:", error);
              Alert.alert("Error", "Failed to complete this job. Please try again.");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
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
            <PrimaryButton
              label="Mark as Complete"
              fullWidth
              onPress={handleMarkComplete}
              disabled={submitting}
              loading={submitting}
            />
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
    </SafeAreaView>
  );
}
