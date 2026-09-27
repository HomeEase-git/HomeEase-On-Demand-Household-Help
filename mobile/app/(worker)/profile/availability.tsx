import React, { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Switch, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import * as api from "../../../services/api";
import type { CalendarDay } from "../../../services/api";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { formatTime12h, phTodayIso } from "../../../utils/bookingTime";
import { dayTint } from "../../../utils/calendarLoad";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// How far ahead the worker can scroll (matches the client booking window).
const MONTHS_AHEAD = 2;

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The worker's availability calendar. Days follow the weekly schedule (the
 * "Weekly Schedule" button) unless changed here one by one. Each day is tinted
 * by how many accepted jobs / follow-up visits fall on it. Workers aren't
 * limited to a number of jobs a day.
 */
export default function AvailabilityScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const todayIso = phTodayIso();
  const [todayYear, todayMonth] = [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7)) - 1];

  const [viewYear, setViewYear] = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonth);
  const [days, setDays] = useState<Record<string, CalendarDay>>({});
  const [availableDays, setAvailableDays] = useState<number[]>([]);
  const [isAvailable, setIsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayIso);
  // Multi-select mode for closing/opening several days at once (e.g. a vacation).
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);

  const monthsFromNow = (viewYear - todayYear) * 12 + (viewMonth - todayMonth);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = iso(viewYear, viewMonth, 1);
      const to = iso(viewYear, viewMonth, new Date(viewYear, viewMonth + 1, 0).getDate());
      const calendar = await api.getMyCalendar(from, to);
      setDays(Object.fromEntries(calendar.days.map((d) => [d.date, d])));
      setAvailableDays(calendar.availableDays);
      setIsAvailable(calendar.isAvailable);
    } catch (error) {
      console.error("Load calendar error:", error);
      alertModal.error("Couldn't load your calendar", "Please try again.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear, viewMonth]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const goMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
    setSelectedDate(null);
  };

  const weeks = useMemo(() => {
    const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [firstWeekday, daysInMonth]);

  const setOverride = async (dates: string[], value: boolean | null) => {
    setSaving(true);
    try {
      await api.updateDateOverrides(dates, value);
      setSelection([]);
      setSelecting(false);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update your calendar.";
      alertModal.error("Couldn't save", message);
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (value: boolean) => {
    setIsAvailable(value);
    try {
      await api.updateAvailability(value, undefined);
    } catch (error) {
      setIsAvailable(!value);
      const message = error instanceof Error ? error.message : "Failed to update.";
      alertModal.error("Couldn't save", message);
    }
  };

  const pressDay = (date: string) => {
    if (date < todayIso) return;
    if (selecting) {
      setSelection((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));
    } else {
      setSelectedDate(date);
    }
  };

  const selected = selectedDate ? days[selectedDate] : undefined;
  const selectedWeekday = selectedDate ? new Date(`${selectedDate}T00:00:00`).getDay() : null;
  const weeklyScheduleSummary =
    availableDays.length === 0
      ? "No working days set"
      : availableDays.length === 7
        ? "Every day"
        : availableDays.map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Availability" showBack />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {/* Weekly repeated schedule */}
        <Pressable
          onPress={() => router.push("/(worker)/profile/availability-template")}
          className="bg-card rounded-2xl p-4 flex-row items-center mb-3"
          style={cardShadow}
        >
          <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
            <Ionicons name="repeat" size={18} color={colors.accent.DEFAULT} />
          </View>
          <View className="flex-1">
            <Text className="text-text-primary font-bold text-sm">Weekly Schedule</Text>
            <Text className="text-text-muted text-xs mt-0.5">{weeklyScheduleSummary}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.text.muted} />
        </Pressable>

        <View className="bg-card rounded-2xl p-4 flex-row items-center justify-between mb-4" style={cardShadow}>
          <View className="flex-1 pr-3">
            <Text className="text-text-primary font-bold text-sm">Taking new jobs</Text>
            <Text className="text-text-muted text-xs mt-0.5">Turn off to pause all new requests.</Text>
          </View>
          <Switch
            value={isAvailable}
            onValueChange={togglePause}
            trackColor={{ false: colors.divider, true: colors.brand.DEFAULT }}
            thumbColor={colors.white}
          />
        </View>

        {/* Calendar */}
        <View className="bg-card rounded-2xl p-4" style={cardShadow}>
          <View className="flex-row items-center justify-between mb-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              disabled={monthsFromNow <= 0}
              onPress={() => goMonth(-1)}
              className={`w-8 h-8 rounded-full bg-surface items-center justify-center ${monthsFromNow <= 0 ? "opacity-30" : ""}`}
            >
              <Ionicons name="chevron-back" size={18} color={colors.brand.DEFAULT} />
            </Pressable>
            <Text className="text-text-primary font-bold text-base">
              {MONTHS[viewMonth]} {viewYear}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              disabled={monthsFromNow >= MONTHS_AHEAD}
              onPress={() => goMonth(1)}
              className={`w-8 h-8 rounded-full bg-surface items-center justify-center ${
                monthsFromNow >= MONTHS_AHEAD ? "opacity-30" : ""
              }`}
            >
              <Ionicons name="chevron-forward" size={18} color={colors.brand.DEFAULT} />
            </Pressable>
          </View>

          <View className="flex-row mb-1">
            {WEEKDAY_LABELS.map((d) => (
              <View key={d} className="flex-1 items-center">
                <Text className="text-text-muted text-xs font-bold">{d}</Text>
              </View>
            ))}
          </View>

          {loading ? (
            <View className="py-16 items-center">
              <ActivityIndicator />
            </View>
          ) : (
            weeks.map((week, row) => (
              <View key={row} className="flex-row mb-1">
                {week.map((dayNum, col) => {
                  if (dayNum === null) return <View key={col} className="flex-1" />;
                  const date = iso(viewYear, viewMonth, dayNum);
                  const day = days[date];
                  const isPast = date < todayIso;
                  const isSelected = selecting ? selection.includes(date) : selectedDate === date;
                  return (
                    <View key={col} className="flex-1 items-center">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${date}, ${day?.available ? "available" : "day off"}, ${day?.jobCount ?? 0} jobs`}
                        accessibilityState={{ selected: isSelected, disabled: isPast }}
                        disabled={isPast}
                        onPress={() => pressDay(date)}
                        className={`w-10 h-11 rounded-xl items-center justify-center border-2 ${dayTint(day)} ${
                          isSelected ? "border-accent" : "border-transparent"
                        } ${isPast ? "opacity-40" : ""}`}
                      >
                        <Text
                          className={`text-sm font-semibold ${
                            day && !day.available && day.jobCount === 0 ? "text-text-muted" : "text-text-primary"
                          } ${date === todayIso ? "underline" : ""}`}
                        >
                          {dayNum}
                        </Text>
                        {!!day?.jobCount && <Text className="text-[9px] text-text-secondary">{day.jobCount}</Text>}
                        {day?.overridden && !day.jobCount && <View className="w-1 h-1 rounded-full bg-accent mt-0.5" />}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))
          )}

          {/* Legend */}
          <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-3">
            {[
              { cls: "bg-success/20", label: "1 job" },
              { cls: "bg-warning/20", label: "2-3 jobs" },
              { cls: "bg-error/20", label: "4+ jobs" },
              { cls: "bg-neutral-300/50", label: "Day off" },
            ].map((item) => (
              <View key={item.label} className="flex-row items-center">
                <View className={`w-3 h-3 rounded ${item.cls} mr-1.5`} />
                <Text className="text-text-muted text-xs">{item.label}</Text>
              </View>
            ))}
            <View className="flex-row items-center">
              <View className="w-1.5 h-1.5 rounded-full bg-accent mr-1.5" />
              <Text className="text-text-muted text-xs">Changed from weekly schedule</Text>
            </View>
          </View>
        </View>

        {/* Several days at once */}
        <View className="mt-3">
          {selecting ? (
            <View className="bg-card rounded-2xl p-4" style={cardShadow}>
              <Text className="text-text-primary font-bold text-sm">
                {selection.length === 0 ? "Tap the days to change" : `${selection.length} day${selection.length === 1 ? "" : "s"} selected`}
              </Text>
              <View className="flex-row gap-2 mt-3">
                <View className="flex-1">
                  <OutlinedButton
                    label="Day off"
                    fullWidth
                    disabled={selection.length === 0 || saving}
                    onPress={() => setOverride(selection, false)}
                  />
                </View>
                <View className="flex-1">
                  <OutlinedButton
                    label="Working"
                    fullWidth
                    disabled={selection.length === 0 || saving}
                    onPress={() => setOverride(selection, true)}
                  />
                </View>
              </View>
              <Pressable
                onPress={() => {
                  setSelecting(false);
                  setSelection([]);
                }}
                className="items-center mt-3"
              >
                <Text className="text-text-muted text-sm">Done</Text>
              </Pressable>
            </View>
          ) : (
            <OutlinedButton label="Select several days (e.g. a vacation)" onPress={() => setSelecting(true)} />
          )}
        </View>

        {/* The picked day */}
        {!selecting && selectedDate && selected && (
          <View className="bg-card rounded-2xl p-4 mt-3" style={cardShadow}>
            <Text className="text-text-primary font-bold text-base">
              {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric" })}
            </Text>
            <Text className="text-text-muted text-xs mt-0.5">
              {selected.available ? "You're working this day" : "Day off"}
              {selected.overridden
                ? " (changed from your weekly schedule)"
                : selectedWeekday != null
                  ? ` (your weekly schedule for ${DAY_NAMES[selectedWeekday]}s)`
                  : ""}
            </Text>

            {selected.jobs.length > 0 ? (
              <View className="mt-3">
                {selected.jobs.map((job) => (
                  <Pressable
                    key={`${job.bookingId}-${job.kind}-${job.time}`}
                    onPress={() => router.push(`/(worker)/records/job/${job.bookingId}`)}
                    className="flex-row items-center py-2.5 border-b border-divider"
                  >
                    <Text className="text-text-primary font-semibold text-sm w-20">{formatTime12h(job.time)}</Text>
                    <View className="flex-1">
                      <Text className="text-text-primary text-sm" numberOfLines={1}>
                        {job.service}
                      </Text>
                      {job.kind === "VISIT" && <Text className="text-accent text-xs">Follow-up visit</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.text.muted} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text className="text-text-secondary text-sm mt-3">No jobs this day.</Text>
            )}

            <View className="flex-row gap-2 mt-4">
              <View className="flex-1">
                <PrimaryButton
                  label={selected.available ? "Make it a day off" : "Work this day"}
                  fullWidth
                  disabled={saving}
                  loading={saving}
                  onPress={() => setOverride([selectedDate], !selected.available)}
                />
              </View>
              {selected.overridden && (
                <View className="flex-1">
                  <OutlinedButton
                    label="Use weekly schedule"
                    fullWidth
                    disabled={saving}
                    onPress={() => setOverride([selectedDate], null)}
                  />
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
