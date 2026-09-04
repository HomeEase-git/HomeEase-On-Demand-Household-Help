import React, { useMemo, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

const DAYS_AHEAD = 21;
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Local-calendar formatting, not toISOString() — that converts through UTC
// first, which silently rolls the date back a day for any UTC+ timezone
// (e.g. PH, UTC+8) when called on a local midnight Date.
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildWeeks(firstDayOffset: number, daysInMonth: number): (number | null)[][] {
  const totalCells = firstDayOffset + daysInMonth;
  const totalRows = Math.ceil(totalCells / 7);
  const weeks: (number | null)[][] = [];
  let day = 1;
  for (let r = 0; r < totalRows; r++) {
    const week: (number | null)[] = [];
    for (let c = 0; c < 7; c++) {
      const cellIndex = r * 7 + c;
      if (cellIndex < firstDayOffset || day > daysInMonth) {
        week.push(null);
      } else {
        week.push(day);
        day++;
      }
    }
    weeks.push(week);
  }
  return weeks;
}

type Props = {
  selectedDate: string | null;
  onSelect: (isoDate: string) => void;
  unavailableDates?: string[];
};

/**
 * Month-grid date picker, capped to the next DAYS_AHEAD days to match the
 * booking flow's near-term-only scheduling window (dates outside that
 * window render dimmed/disabled rather than being hidden, so the calendar
 * shape stays intact). Today is bookable and priced the same as any other
 * date — the backend has no same-day surcharge (only urgencyLevel affects
 * price, see bookingController.createBooking) — so it's marked with a ring
 * to call it out as "today", not disabled or upcharged.
 */
export default function DateGridPicker({ selectedDate, onSelect, unavailableDates = [] }: Props) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayIso = useMemo(() => toIsoDate(today), [today]);

  const maxDate = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() + DAYS_AHEAD - 1);
    return d;
  }, [today]);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const isPrevDisabled = viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const isNextDisabled = viewYear === maxDate.getFullYear() && viewMonth === maxDate.getMonth();

  const goToPrevMonth = () => {
    if (isPrevDisabled) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  };

  const goToNextMonth = () => {
    if (isNextDisabled) return;
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  };

  const firstDayOffset = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const weeks = useMemo(
    () => buildWeeks(firstDayOffset, daysInMonth),
    [firstDayOffset, daysInMonth]
  );

  return (
    <View className="bg-card rounded-2xl p-4">
      <View className="flex-row items-center justify-between mb-4">
        <Pressable
          onPress={goToPrevMonth}
          disabled={isPrevDisabled}
          hitSlop={8}
          className={`w-8 h-8 rounded-full bg-surface items-center justify-center ${
            isPrevDisabled ? "opacity-30" : ""
          }`}
        >
          <Ionicons name="chevron-back" size={18} color={colors.brand.DEFAULT} />
        </Pressable>
        <Text className="text-text-primary font-bold text-base">
          {MONTHS[viewMonth]} {viewYear}
        </Text>
        <Pressable
          onPress={goToNextMonth}
          disabled={isNextDisabled}
          hitSlop={8}
          className={`w-8 h-8 rounded-full bg-surface items-center justify-center ${
            isNextDisabled ? "opacity-30" : ""
          }`}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.brand.DEFAULT} />
        </Pressable>
      </View>

      <View className="flex-row mb-2">
        {DAY_LABELS.map((d, i) => (
          <View key={`${d}-${i}`} className="flex-1 items-center">
            <Text className="text-text-muted text-xs font-bold">{d}</Text>
          </View>
        ))}
      </View>

      {weeks.map((week, rowIndex) => (
        <View key={rowIndex} className="flex-row mb-1.5">
          {week.map((day, colIndex) => {
            if (day === null) {
              return <View key={colIndex} className="flex-1 items-center" />;
            }

            const date = new Date(viewYear, viewMonth, day);
            const iso = toIsoDate(date);
            const isToday = iso === todayIso;
            const isSelected = selectedDate === iso;
            const isOutOfRange = date < today || date > maxDate;
            const isUnavailable = isOutOfRange || unavailableDates.includes(iso);

            return (
              <View key={colIndex} className="flex-1 items-center">
                <Pressable
                  disabled={isUnavailable}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: isUnavailable }}
                  onPress={() => onSelect(iso)}
                  className={`w-10 h-10 rounded-xl items-center justify-center border-2 ${
                    isSelected
                      ? "bg-accent border-accent"
                      : isToday
                      ? "bg-warning/10 border-warning"
                      : "bg-transparent border-transparent"
                  } ${isUnavailable ? "opacity-30" : ""}`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      isSelected ? "text-white" : isToday ? "text-warning" : "text-text-primary"
                    }`}
                  >
                    {day}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
