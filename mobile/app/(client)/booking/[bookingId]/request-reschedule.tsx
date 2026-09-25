import React, { useEffect, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { ScreenSkeleton } from "../../../../components/feedback/ScreenSkeleton";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import DateGridPicker from "../../../../components/booking4step/DateGridPicker";
import TimeSlotPicker from "../../../../components/ui/TimeSlotPicker";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import { getBookingDetail, requestReschedule } from "../../../../services/api";
import { useSlotAvailabilityCounts } from "../../../../hooks/useWorkerDiscovery";
import { TIME_SLOTS, type TimeSlot } from "../../../../types/booking4step.types";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

/**
 * Client-initiated reschedule request — proposes a new date/time for an
 * ACCEPTED booking's already-assigned worker. Reuses the same
 * DateGridPicker/TimeSlotPicker + per-slot availability-count pattern
 * step-2.tsx already uses for a locked (profile-picked) worker, scoped here
 * to this booking's fixed worker instead of a new-booking draft.
 */
export default function RequestRescheduleScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();

  const [loading, setLoading] = useState(true);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [workerName, setWorkerName] = useState<string>("your pro");
  const [date, setDate] = useState<string | null>(null);
  const [timeSlot, setTimeSlot] = useState<TimeSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const detail = await getBookingDetail(bookingId);
        if (!active) return;
        setWorkerId(detail.worker?.id ?? null);
        setWorkerName(detail.worker?.fullName ?? "your pro");
      } catch (error) {
        console.error("Load booking for reschedule request error:", error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [bookingId]);

  const { counts, loading: loadingCounts } = useSlotAvailabilityCounts(
    { workerId: workerId ?? undefined, date: date ?? undefined },
    !!workerId && !!date,
  );

  const noSlotsThisDay = !!date && !loadingCounts && TIME_SLOTS.every((slot) => counts[slot] === 0);
  const canSubmit = !!date && !!timeSlot && !noSlotsThisDay;

  const handleSubmit = async () => {
    if (!canSubmit || !date || !timeSlot) {
      alertModal.warning("Pick a date and time", "Choose a new date and time slot to request.");
      return;
    }

    setSubmitting(true);
    try {
      await requestReschedule(bookingId, date, timeSlot);
      alertModal.success(
        "Request Sent",
        `${workerName} will be notified and can accept or decline the new date.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error: any) {
      console.error("Request reschedule error:", error);
      alertModal.error("Error", error?.message || "Failed to send your reschedule request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Request Reschedule" showBack />
        <ScreenSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Request Reschedule" showBack />
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text className="text-text-secondary text-sm mb-4">
          Suggest a new date and time. {workerName} has to accept it, and your current date stays booked until then.
        </Text>

        <Text className="text-text-primary font-bold text-lg mb-3">New date</Text>
        <DateGridPicker selectedDate={date} onSelect={setDate} />

        <Text className="text-text-primary font-bold text-lg mt-6 mb-3">New time</Text>
        <TimeSlotPicker
          value={timeSlot}
          onChange={setTimeSlot}
          counts={date ? counts : undefined}
          loadingCounts={loadingCounts}
        />

        {noSlotsThisDay && (
          <Text className="text-error text-sm mt-2">
            {workerName} isn&apos;t available on this date. Try a different date.
          </Text>
        )}

        <View className="mt-8">
          <PrimaryButton
            label={submitting ? "Sending..." : "Send Request"}
            fullWidth
            disabled={!canSubmit || submitting}
            loading={submitting}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
