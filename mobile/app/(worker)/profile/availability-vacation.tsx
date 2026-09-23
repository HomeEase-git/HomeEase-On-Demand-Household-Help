import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import DateGridPicker from "../../../components/booking4step/DateGridPicker";
import * as api from "../../../services/api";
import { useAlertModal } from "../../../contexts/AlertModalContext";

// A worker picking vacation/leave dates has no minimum lead time (unlike a
// client booking a job) and benefits from a longer horizon than the
// booking flow's 21-day window.
const VACATION_DAYS_AHEAD = 90;

function formatDisplay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Bulk "mark unavailable" (see B8) — blocks every time slot across a date
 * range in one call, for a vacation/leave stretch, instead of a worker
 * closing each date one at a time on the main Availability screen.
 */
export default function AvailabilityVacationScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();

  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSelectStart = (iso: string) => {
    setStartDate(iso);
    if (endDate && endDate < iso) setEndDate(null);
  };

  const handleSelectEnd = (iso: string) => {
    if (startDate && iso < startDate) {
      alertModal.warning("Pick an end date on or after the start date", "Choose the start date again if needed.");
      return;
    }
    setEndDate(iso);
  };

  const handleConfirm = async () => {
    if (!startDate || !endDate) {
      alertModal.warning("Pick a range", "Choose both a start and end date.");
      return;
    }

    setSaving(true);
    try {
      await api.setUnavailableRange(startDate, endDate);
      alertModal.success(
        "Marked Unavailable",
        `You're blocked off from ${formatDisplay(startDate)} to ${formatDisplay(endDate)}.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Set unavailable range error:", error);
      const message = error instanceof Error ? error.message : "Failed to mark this range unavailable.";
      alertModal.error("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} className="bg-surface">
      <ScreenHeader title="Mark Unavailable" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text className="text-text-secondary text-sm mb-4">
          Block off every slot in a date range, like for a vacation. Dates with an active booking are skipped, so
          resolve those jobs first.
        </Text>

        <Text className="text-text-primary font-bold text-base mb-2">Start date</Text>
        <DateGridPicker selectedDate={startDate} onSelect={handleSelectStart} minLeadDays={0} daysAhead={VACATION_DAYS_AHEAD} />

        <Text className="text-text-primary font-bold text-base mt-6 mb-2">End date</Text>
        <DateGridPicker selectedDate={endDate} onSelect={handleSelectEnd} minLeadDays={0} daysAhead={VACATION_DAYS_AHEAD} />

        {startDate && endDate && (
          <View className="bg-card rounded-2xl p-4 mt-6">
            <Text className="text-text-primary font-semibold text-sm">
              {formatDisplay(startDate)} — {formatDisplay(endDate)}
            </Text>
          </View>
        )}

        <View className="mt-8">
          <PrimaryButton
            label={saving ? "Saving..." : "Block These Dates"}
            fullWidth
            disabled={!startDate || !endDate || saving}
            loading={saving}
            onPress={handleConfirm}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
