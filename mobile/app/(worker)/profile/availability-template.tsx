import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../components/ui/Skeleton";
import * as api from "../../../services/api";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

// Monday first, the way people think about a work week.
const WEEK: { day: number; label: string }[] = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 4, label: "Thursday" },
  { day: 5, label: "Friday" },
  { day: 6, label: "Saturday" },
  { day: 0, label: "Sunday" },
];

const PRESETS: { label: string; days: number[] }[] = [
  { label: "Mon – Fri", days: [1, 2, 3, 4, 5] },
  { label: "Mon – Sat", days: [1, 2, 3, 4, 5, 6] },
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
];

/**
 * The worker's repeating weekly schedule: just the days they work (e.g.
 * Monday to Friday). Every week follows it; single dates are changed on the
 * calendar. Clients book any start time on a working day.
 */
export default function WeeklyScheduleScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [days, setDays] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getMyWorkerProfileDetails()
      .then((profile) => {
        if (active) setDays(profile.availableDays ?? []);
      })
      .catch((error) => console.error("Load weekly schedule error:", error))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggle = (day: number) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));

  const handleSave = async () => {
    if (days.length === 0) {
      alertModal.warning("Pick at least one day", "Clients can only book you on the days you work.");
      return;
    }
    setSaving(true);
    try {
      await api.updateWeeklySchedule(days);
      alertModal.success("Saved", "Your weekly schedule is saved. Change single dates on the calendar.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save your weekly schedule.";
      alertModal.error("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Weekly Schedule" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <Text className="text-text-muted text-sm mb-4">
          Choose the days you usually work. Clients can book you any time on those days, and you can still change single
          dates on your calendar.
        </Text>

        <View className="flex-row gap-2 mb-4">
          {PRESETS.map((preset) => {
            const active = preset.days.length === days.length && preset.days.every((d) => days.includes(d));
            return (
              <Pressable
                key={preset.label}
                onPress={() => setDays(preset.days)}
                className={`flex-1 rounded-xl py-2.5 items-center border ${
                  active ? "bg-accent border-accent" : "bg-card border-divider"
                }`}
              >
                <Text className={`text-xs font-semibold ${active ? "text-white" : "text-text-secondary"}`}>
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={52} borderRadius={16} marginBottom={8} />
          ))
        ) : (
          <View className="gap-2">
            {WEEK.map(({ day, label }) => {
              const on = days.includes(day);
              return (
                <Pressable
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => toggle(day)}
                  className="bg-card rounded-2xl p-4 flex-row items-center"
                  style={cardShadow}
                >
                  <Text className="text-text-primary font-semibold text-sm flex-1">{label}</Text>
                  <Ionicons
                    name={on ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={on ? colors.accent.DEFAULT : colors.text.muted}
                  />
                </Pressable>
              );
            })}
          </View>
        )}

        <View className="mt-8">
          <PrimaryButton label="Save Weekly Schedule" fullWidth onPress={handleSave} disabled={saving || loading} loading={saving} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
