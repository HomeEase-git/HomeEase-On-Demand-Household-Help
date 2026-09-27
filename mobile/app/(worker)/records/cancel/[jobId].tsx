import React, { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import DangerButton from "../../../../components/ui/DangerButton";
import GenericConfirmationModal from "../../../../components/modals/GenericConfirmationModal";
import { useWorkerStore } from "../../../../store/workerStore";
import { cancelBooking, getBookingDetail } from "../../../../services/api";
import ProofPhotosField from "../../../../components/booking/ProofPhotosField";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

// category feeds the backend's required workerCancellationReason — only
// WORKER_FAULT dents the worker's auto-match score (see
// matchingService/cancelBooking). Letting a worker honestly pick "the
// client wasn't there" instead of it always counting against them the same
// as a genuine no-show on their part is the whole point of this field.
const REASONS: Array<{ label: string; category: "WORKER_FAULT" | "CLIENT_NO_SHOW" | "OTHER" }> = [
  { label: "Can no longer make the schedule", category: "WORKER_FAULT" },
  { label: "Outside my service area", category: "WORKER_FAULT" },
  { label: "Client wasn't home / unreachable", category: "CLIENT_NO_SHOW" },
  { label: "Job scope is different than described", category: "OTHER" },
  { label: "Emergency came up", category: "OTHER" },
  { label: "Other", category: "OTHER" },
];

// After arriving, the worker says whose fault it is and shows proof (see
// backend cancelBooking). Mirrors AppSettings.noShowPenaltyAmount /
// clientFaultCompensationAmount defaults, for the explanation only.
const PENALTY = 200;
const COMPENSATION = 200;
const ON_SITE_REASONS: Array<{ label: string; fault: "CLIENT" | "WORKER" }> = [
  { label: "The client wasn't there or wouldn't let me in", fault: "CLIENT" },
  { label: "The job isn't what the client booked", fault: "CLIENT" },
  { label: "The place isn't safe to work in", fault: "CLIENT" },
  { label: "I can't do the job (tools, skills or materials)", fault: "WORKER" },
  { label: "Personal emergency", fault: "WORKER" },
];

export default function WorkerCancelJobScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const updateJobStatus = useWorkerStore((s) => s.updateJobStatus);
  const [reason, setReason] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  // Whether the worker already checked in at the job site.
  const [arrived, setArrived] = useState<boolean | null>(null);
  const [onSiteReason, setOnSiteReason] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  const [proofUrls, setProofUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!jobId) return;
    getBookingDetail(jobId)
      .then((detail) => setArrived(!!(detail?.timeline?.workerArrivedAt ?? detail?.workerArrivedAt)))
      .catch(() => setArrived(false));
  }, [jobId]);

  const onSiteFault = ON_SITE_REASONS.find((r) => r.label === onSiteReason)?.fault ?? null;
  const canConfirm = arrived
    ? !!onSiteFault && details.trim().length >= 10 && proofUrls.length > 0
    : !!reason && (reason !== "Other" || otherText.trim().length > 0);

  const handleConfirmCancel = async () => {
    setConfirmVisible(false);
    if (!jobId) return;

    const finalReason = arrived
      ? `${onSiteReason}: ${details.trim()}`
      : reason === "Other"
        ? otherText.trim()
        : (reason ?? "");
    const category = REASONS.find((r) => r.label === reason)?.category ?? "OTHER";

    setLoading(true);
    try {
      const result = await cancelBooking(
        jobId,
        finalReason,
        category,
        arrived && onSiteFault ? { fault: onSiteFault, proofUrls } : undefined,
      );
      updateJobStatus(jobId, "Cancelled");
      alertModal.success(
        "Job Cancelled",
        result?.compensationStatus === "PENDING_REVIEW"
          ? "The client was notified. HomeEase will review your proof; if it's confirmed, you'll be compensated."
          : result?.penaltyAmount
            ? `The client was notified. A ₱${result.penaltyAmount} penalty was added to your dues.`
            : "This job has been cancelled and the client was notified.",
        [{ text: "OK", onPress: () => router.replace("/(worker)/records") }],
      );
    } catch (error: any) {
      console.error("Worker cancel booking error:", error);
      alertModal.error("Error", error?.message || "Failed to cancel this job. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Cancel Job" showBack />
      <KeyboardAwareScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 24, paddingBottom: 40 }}
      >
        {arrived ? (
          <>
            <View className="bg-error/10 border border-error rounded-xl p-4 flex-row items-start mb-4">
              <Ionicons name="warning-outline" size={24} color={colors.error} />
              <Text className="text-error ml-2 flex-1 text-sm">
                You&apos;ve already checked in at the job site, so cancelling needs photo proof. If it&apos;s your fault,
                a ₱{PENALTY} penalty is added to your dues. If it&apos;s the client&apos;s, HomeEase reviews your proof and
                you&apos;re compensated ₱{COMPENSATION} if it holds up — otherwise the penalty applies.
              </Text>
            </View>

            <Text className="text-text-secondary text-sm font-semibold mb-2">What happened?</Text>
            {ON_SITE_REASONS.map((r) => (
              <Pressable
                key={r.label}
                className={`bg-card rounded-xl p-3 mb-2 flex-row items-center ${
                  onSiteReason === r.label ? "border-2 border-accent" : "border-2 border-transparent"
                }`}
                onPress={() => setOnSiteReason(r.label)}
              >
                <View
                  className={`w-5 h-5 rounded-full border-2 border-accent items-center justify-center mr-3 ${
                    onSiteReason === r.label ? "bg-accent" : ""
                  }`}
                >
                  {onSiteReason === r.label && <View className="w-2 h-2 rounded-full bg-white" />}
                </View>
                <View className="flex-1">
                  <Text className="text-text-primary">{r.label}</Text>
                  <Text className="text-text-muted text-xs">{r.fault === "CLIENT" ? "Client's side" : "My side"}</Text>
                </View>
              </Pressable>
            ))}

            <View className="mt-2">
              <InputField
                label="Explain what happened"
                value={details}
                onChangeText={setDetails}
                placeholder="At least 10 characters"
                multiline
              />
            </View>

            <ProofPhotosField
              bookingId={jobId}
              label="Photo proof"
              hint="e.g. the locked gate, the site condition, or the part you can't get"
              urls={proofUrls}
              onChange={setProofUrls}
              required
            />
          </>
        ) : (
          <>
            <View className="bg-error/10 border border-error rounded-xl p-4 flex-row items-start mb-4">
              <Ionicons name="warning-outline" size={24} color={colors.error} />
              <Text className="text-error ml-2 flex-1 text-sm">
                Cancelling less than 24 hours before the job, for a reason on your
                end, lowers your ranking in auto-match.
              </Text>
            </View>

            <Text className="text-text-secondary text-sm font-semibold mb-2">
              Reason for cancelling
            </Text>
            {REASONS.map((r) => (
              <Pressable
                key={r.label}
                className={`bg-card rounded-xl p-3 mb-2 flex-row items-center ${
                  reason === r.label ? "border-2 border-accent" : "border-2 border-transparent"
                }`}
                onPress={() => setReason(r.label)}
              >
                <View
                  className={`w-5 h-5 rounded-full border-2 border-accent items-center justify-center mr-3 ${
                    reason === r.label ? "bg-accent" : ""
                  }`}
                >
                  {reason === r.label && <View className="w-2 h-2 rounded-full bg-white" />}
                </View>
                <Text className="text-text-primary">{r.label}</Text>
              </Pressable>
            ))}

            {reason === "Other" && (
              <View className="mt-2">
                <InputField
                  label="Please specify"
                  value={otherText}
                  onChangeText={setOtherText}
                  placeholder="Tell the client why..."
                  multiline
                />
              </View>
            )}

          </>
        )}

        <View className="flex-row gap-3 mt-8">
          <OutlinedButton label="Keep Job" onPress={() => router.back()} />
          <View className="flex-1">
            <DangerButton
              label={loading ? "Cancelling..." : "Cancel Job"}
              fullWidth
              disabled={!canConfirm || loading}
              onPress={() => setConfirmVisible(true)}
            />
          </View>
        </View>
      </KeyboardAwareScrollView>

      <GenericConfirmationModal
        visible={confirmVisible}
        title="Cancel this job?"
        message={
          arrived && onSiteFault === "WORKER"
            ? `This can't be undone, and a ₱${PENALTY} penalty will be added to your dues.`
            : "This action cannot be undone."
        }
        confirmLabel="Confirm"
        cancelLabel="Keep"
        onConfirm={handleConfirmCancel}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}
