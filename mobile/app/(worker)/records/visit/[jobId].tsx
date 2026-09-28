import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "../../../../components/ui/KeyboardAwareScrollView";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import DateGridPicker from "../../../../components/booking4step/DateGridPicker";
import StartTimePicker from "../../../../components/ui/StartTimePicker";
import { getMyCalendar, scheduleFollowUpVisit } from "../../../../services/api";
import { colors } from "../../../../constants";
import { useAlertModal } from "../../../../contexts/AlertModalContext";
import { MAX_BOOKING_DAYS_AHEAD, earliestStartTime, formatTime12h } from "../../../../utils/bookingTime";

/**
 * "Follow Up Date": when a job needs more than one day, the worker picks the
 * next visit's date and start time. The job stays one booking with one
 * price; the client is told and the visit shows on both calendars. The
 * worker sees their other jobs that day so they don't double-book
 * themselves.
 */
export default function ScheduleVisitScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();

  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busyTimes, setBusyTimes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!date) return;
    let active = true;
    getMyCalendar(date, date)
      .then((c) => {
        if (active) setBusyTimes(c.days[0]?.jobs.filter((j) => j.bookingId !== jobId).map((j) => j.time) ?? []);
      })
      .catch(() => {
        if (active) setBusyTimes([]);
      });
    return () => {
      active = false;
    };
  }, [date, jobId]);

  // No lead time for the worker's own plan — any later time today is fine.
  const minTime = useMemo(() => earliestStartTime(date, 0), [date]);

  const handleSave = async () => {
    if (!jobId || !date || !time) return;
    setSaving(true);
    try {
      const result = await scheduleFollowUpVisit(jobId, date, time, notes.trim() || undefined);
      const clash =
        result.nearbyJobs.length > 0
          ? `\n\nHeads-up: you have ${result.nearbyJobs.map((j) => `${j.service} at ${formatTime12h(j.time)}`).join(", ")} around then.`
          : "";
      alertModal.success("Visit Scheduled", `The client has been told about the next visit.${clash}`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error: any) {
      console.error("Schedule visit error:", error);
      alertModal.error("Couldn't schedule", error?.message || "Failed to schedule the visit. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Follow-up Visit" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <View className="bg-accent/10 rounded-xl p-4 flex-row items-start mb-4">
          <Ionicons name="information-circle-outline" size={20} color={colors.accent.DEFAULT} />
          <Text className="text-text-secondary ml-2 flex-1 text-sm">
            Need another day to finish? Pick when you&apos;ll come back. It&apos;s the same job and price — the client is
            notified and it appears on your calendar.
          </Text>
        </View>

        <Text className="text-text-primary font-bold text-base mb-2">Visit date</Text>
        <DateGridPicker
          selectedDate={date}
          onSelect={setDate}
          daysAhead={MAX_BOOKING_DAYS_AHEAD + 1}
        />

        <Text className="text-text-primary font-bold text-base mt-6 mb-2">Start time</Text>
        <StartTimePicker value={time} onChange={setTime} minTime={minTime} busyTimes={busyTimes} />

        <Text className="text-text-primary font-bold text-base mt-6 mb-2">Note for the client (optional)</Text>
        <TextInput
          className="bg-card rounded-xl px-3 py-3 text-text-primary"
          placeholder="e.g. Second coat of paint once the first has dried"
          placeholderTextColor={colors.text.muted}
          value={notes}
          onChangeText={setNotes}
          maxLength={500}
          multiline
        />

        <View className="mt-8">
          <PrimaryButton
            label={saving ? "Scheduling..." : "Schedule Visit"}
            fullWidth
            disabled={!date || !time || saving}
            loading={saving}
            onPress={handleSave}
          />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
