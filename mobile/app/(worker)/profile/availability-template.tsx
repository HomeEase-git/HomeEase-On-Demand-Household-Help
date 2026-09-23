import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../components/ui/Skeleton";
import * as api from "../../../services/api";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { TIME_SLOTS, TIME_SLOT_LABELS, type TimeSlot } from "../../../types/booking4step.types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6];

type TemplateState = Record<number, Record<TimeSlot, boolean>>;

function emptyTemplate(): TemplateState {
  const state = {} as TemplateState;
  for (const day of DAYS_OF_WEEK) {
    state[day] = { MORNING: false, AFTERNOON: false, EVENING: false };
  }
  return state;
}

/**
 * A worker's recurring weekly pattern (see B8) — distinct from the concrete,
 * next-7-days schedule on the main Availability screen. Saving this
 * auto-opens matching slots ~30 days ahead and keeps rolling that window
 * forward daily, so a stable weekly schedule doesn't need re-opening by hand
 * every week.
 */
export default function AvailabilityTemplateScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();

  const [template, setTemplate] = useState<TemplateState>(emptyTemplate);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const days = await api.getMyAvailabilityTemplate();
        if (!active) return;
        const next = emptyTemplate();
        for (const d of days) {
          if (next[d.dayOfWeek]) next[d.dayOfWeek][d.timeSlot] = true;
        }
        setTemplate(next);
      } catch (error) {
        console.error("Load availability template error:", error);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggle = (dayOfWeek: number, slot: TimeSlot) => {
    setTemplate((prev) => ({
      ...prev,
      [dayOfWeek]: { ...prev[dayOfWeek], [slot]: !prev[dayOfWeek][slot] },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const days: { dayOfWeek: number; timeSlot: TimeSlot }[] = [];
      for (const dayOfWeek of DAYS_OF_WEEK) {
        for (const slot of TIME_SLOTS) {
          if (template[dayOfWeek][slot]) days.push({ dayOfWeek, timeSlot: slot });
        }
      }
      await api.updateMyAvailabilityTemplate(days);
      alertModal.success(
        "Saved",
        "Your weekly pattern is saved. Matching slots are open for the next few weeks.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Save availability template error:", error);
      const message = error instanceof Error ? error.message : "Failed to save your weekly pattern.";
      alertModal.error("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title="Repeat Weekly" showBack />
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <Skeleton width="60%" height={16} marginBottom={16} />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={64} borderRadius={16} marginBottom={10} />
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Repeat Weekly" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <Text className="text-text-muted text-xs mb-4">
          Pick the days and times you&apos;re usually free. Matching slots stay open a few weeks ahead. Days you close
          by hand or block off always override this pattern.
        </Text>

        <View className="gap-3">
          {DAYS_OF_WEEK.map((dayOfWeek) => (
            <View key={dayOfWeek} className="bg-card rounded-2xl p-3.5" style={cardShadow}>
              <Text className="text-text-primary font-semibold text-sm mb-2.5">{DAY_LABELS[dayOfWeek]}</Text>
              <View className="flex-row gap-2">
                {TIME_SLOTS.map((slot) => {
                  const on = template[dayOfWeek][slot];
                  return (
                    <Pressable
                      key={slot}
                      onPress={() => toggle(dayOfWeek, slot)}
                      className={`flex-1 rounded-xl py-2.5 items-center border ${
                        on ? "bg-accent border-accent" : "bg-card-light border-divider"
                      }`}
                    >
                      <Text className={`text-xs font-semibold ${on ? "text-white" : "text-text-secondary"}`}>
                        {TIME_SLOT_LABELS[slot]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        <View className="mt-8">
          <PrimaryButton label="Save Weekly Pattern" fullWidth onPress={handleSave} disabled={saving} loading={saving} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
