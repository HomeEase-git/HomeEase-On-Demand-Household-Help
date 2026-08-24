import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Switch, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { Skeleton } from "../../../components/ui/Skeleton";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import type { WorkerAvailabilitySlot } from "../../../services/api";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { TIME_SLOTS, TIME_SLOT_LABELS, type TimeSlot } from "../../../types/booking4step.types";

const DAYS_AHEAD = 7;
const MAX_SLOTS_PER_DAY = 2;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DaySlotState = Record<TimeSlot, { open: boolean; booked: boolean }>;

export default function AvailabilityScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);

  const days = useMemo(() => {
    const out: { iso: string; date: Date }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      out.push({ iso: toIsoDate(d), date: d });
    }
    return out;
  }, []);

  const [isAvailable, setIsAvailable] = useState(true);
  const [initialIsAvailable, setInitialIsAvailable] = useState(true);
  const [schedule, setSchedule] = useState<Record<string, DaySlotState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user?.id) return;
      setLoading(true);
      try {
        const [detail, slots] = await Promise.all([api.getWorkerDetail(user.id), api.getMyAvailabilitySlots()]);
        if (!active) return;

        if (detail) {
          setIsAvailable(detail.isAvailable);
          setInitialIsAvailable(detail.isAvailable);
        }

        const byDate = new Map<string, WorkerAvailabilitySlot[]>();
        for (const slot of slots) {
          const dateKey = slot.date.slice(0, 10);
          if (!byDate.has(dateKey)) byDate.set(dateKey, []);
          byDate.get(dateKey)!.push(slot);
        }

        const nextSchedule: Record<string, DaySlotState> = {};
        for (const { iso } of days) {
          const daySlots = byDate.get(iso) ?? [];
          const state = {} as DaySlotState;
          for (const slot of TIME_SLOTS) {
            const found = daySlots.find((s) => s.timeSlot === slot);
            state[slot] = { open: !!found && !found.isBlocked, booked: !!found?.isBooked };
          }
          nextSchedule[iso] = state;
        }
        setSchedule(nextSchedule);
      } catch (error) {
        console.error("Load availability error:", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const toggleSlot = (dateIso: string, slot: TimeSlot) => {
    setSchedule((prev) => {
      const day = prev[dateIso];
      if (!day) return prev;
      const current = day[slot];
      if (current.booked) return prev; // can't toggle a booked slot

      if (!current.open) {
        const openCount = TIME_SLOTS.filter((s) => day[s].open).length;
        if (openCount >= MAX_SLOTS_PER_DAY) {
          alertModal.warning("Max 2 slots per day", "Turn off another slot on this day first.");
          return prev;
        }
      }

      return { ...prev, [dateIso]: { ...day, [slot]: { ...current, open: !current.open } } };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const slots: Array<{ date: string; timeSlot: TimeSlot }> = [];
      for (const { iso } of days) {
        const day = schedule[iso];
        if (!day) continue;
        for (const slot of TIME_SLOTS) {
          if (day[slot].open) slots.push({ date: iso, timeSlot: slot });
        }
      }

      await api.updateAvailabilitySlots(slots, days.map((d) => d.iso));

      if (isAvailable !== initialIsAvailable) {
        await api.updateAvailability(isAvailable, undefined);
        setInitialIsAvailable(isAvailable);
      }

      alertModal.success("Saved", "Your availability has been updated.");
      router.back();
    } catch (error) {
      console.error("Save availability error:", error);
      const message = error instanceof Error ? error.message : "Failed to save your schedule.";
      alertModal.error("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScreenHeader title="Availability" showBack />
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
      <ScreenHeader title="Availability" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <View className="bg-card rounded-2xl p-4 flex-row items-center justify-between mb-6" style={cardShadow}>
          <View className="flex-1 pr-3">
            <Text className="text-text-primary font-bold text-sm">Available for new jobs</Text>
            <Text className="text-text-muted text-xs mt-0.5">
              Turn off to pause all new bookings, even on open slots below.
            </Text>
          </View>
          <Switch
            value={isAvailable}
            onValueChange={setIsAvailable}
            trackColor={{ false: colors.divider, true: colors.brand.DEFAULT }}
            thumbColor={colors.white}
          />
        </View>

        <Text className="text-text-primary font-bold text-base mb-1">Next 7 days</Text>
        <Text className="text-text-muted text-xs mb-4">
          Tap a slot to open/close it. Max {MAX_SLOTS_PER_DAY} slots per day. Slots with an active booking can&apos;t
          be closed.
        </Text>

        <View className="gap-3">
          {days.map(({ iso, date }) => {
            const day = schedule[iso];
            const dayLabel = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            const isToday = iso === days[0].iso;

            return (
              <View key={iso} className="bg-card rounded-2xl p-3.5" style={cardShadow}>
                <View className="flex-row items-center justify-between mb-2.5">
                  <Text className="text-text-primary font-semibold text-sm">{dayLabel}</Text>
                  {isToday && (
                    <View className="bg-accent/10 rounded-full px-2 py-0.5">
                      <Text className="text-accent text-[10px] font-bold">Today</Text>
                    </View>
                  )}
                </View>
                <View className="flex-row gap-2">
                  {TIME_SLOTS.map((slot) => {
                    const state = day?.[slot] ?? { open: false, booked: false };
                    return (
                      <Pressable
                        key={slot}
                        disabled={state.booked}
                        onPress={() => toggleSlot(iso, slot)}
                        className={`flex-1 rounded-xl py-2.5 items-center border ${
                          state.booked
                            ? "bg-warning/10 border-warning/30"
                            : state.open
                              ? "bg-accent border-accent"
                              : "bg-card-light border-divider"
                        }`}
                      >
                        {state.booked && (
                          <Ionicons name="lock-closed" size={11} color={colors.warning} style={{ marginBottom: 2 }} />
                        )}
                        <Text
                          className={`text-xs font-semibold ${
                            state.booked ? "text-warning" : state.open ? "text-white" : "text-text-secondary"
                          }`}
                        >
                          {TIME_SLOT_LABELS[slot]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>

        <View className="mt-8">
          <PrimaryButton label="Save Schedule" fullWidth onPress={handleSave} disabled={saving} loading={saving} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
