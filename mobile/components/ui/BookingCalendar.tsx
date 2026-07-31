import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants/colors";

interface Props {
  workerId?: string | null;
  selectedDate: string;
  onDateSelect: (date: string) => void;
  unavailableDates?: string[]; // "YYYY-MM-DD" strings from your API
  workerOffDays?: number[]; // 0=Sun, 1=Mon ... 6=Sat
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const LEAD_TIME_DAYS = 2;
const MAX_RANGE_DAYS = 90;
const BADGE_SIZE = 36;

// Fixed color scheme per date state (background + text pairing).
const DATE_COLORS = {
  available: { bg: colors.neutral[200], text: colors.neutral[700] },
  selected: { bg: colors.success, text: colors.white },
  unavailable: { bg: colors.neutral[400], text: colors.text.black },
  today: { bg: "#FDE047", text: colors.brand.DEFAULT },
};

const toDateString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const NavButton = ({
  icon,
  onPress,
  disabled,
}: {
  icon: "chevron-back" | "chevron-forward";
  onPress: () => void;
  disabled?: boolean;
}) => (
  <Pressable onPress={onPress} disabled={disabled} hitSlop={8}>
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: colors.surface,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Ionicons name={icon} size={18} color={colors.brand.DEFAULT} />
    </View>
  </Pressable>
);

const LegendSwatch = ({ color, label }: { color: string; label: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center" }}>
    <View
      style={{
        width: 12,
        height: 12,
        borderRadius: 4,
        backgroundColor: color,
        marginRight: 5,
      }}
    />
    <Text style={{ fontSize: 11, color: colors.text.secondary }}>{label}</Text>
  </View>
);

const buildWeeks = (
  firstDayOffset: number,
  daysInMonth: number,
): (number | null)[][] => {
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
};

export default function BookingCalendar({
  unavailableDates = [],
  workerOffDays = [0, 6], // defaults to Sat/Sun off
  selectedDate,
  onDateSelect,
}: Props) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDate = new Date(today);
  minDate.setDate(today.getDate() + LEAD_TIME_DAYS);

  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + MAX_RANGE_DAYS);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const isUnavailable = (date: Date) => {
    if (date < minDate || date > maxDate) return true;
    if (workerOffDays.includes(date.getDay())) return true;
    if (unavailableDates.includes(toDateString(date))) return true;
    return false;
  };

  const goToPrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  };

  const goToNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  };

  const isPrevDisabled =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const isNextDisabled =
    viewYear === maxDate.getFullYear() && viewMonth === maxDate.getMonth();

  const firstDayOffset = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const weeks = buildWeeks(firstDayOffset, daysInMonth);

  return (
    <View
      style={{
        backgroundColor: colors.white,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: colors.divider,
        padding: 16,
        marginBottom: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
      }}
    >
      {/* Month navigation */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <NavButton
          icon="chevron-back"
          onPress={goToPrevMonth}
          disabled={isPrevDisabled}
        />
        <Text
          style={{
            fontSize: 16,
            fontWeight: "700",
            color: colors.text.primary,
          }}
        >
          {MONTHS[viewMonth]} {viewYear}
        </Text>
        <NavButton
          icon="chevron-forward"
          onPress={goToNextMonth}
          disabled={isNextDisabled}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 6,
          marginBottom: 14,
        }}
      >
        <Ionicons name="information-circle-outline" size={13} color={colors.text.muted} />
        <Text style={{ fontSize: 11, color: colors.text.muted, marginLeft: 4 }}>
          Bookings need at least {LEAD_TIME_DAYS} days advance notice
        </Text>
      </View>

      {/* Day headers */}
      <View style={{ flexDirection: "row", marginBottom: 8 }}>
        {DAYS.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: "center" }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: colors.text.muted,
                letterSpacing: 0.3,
              }}
            >
              {d}
            </Text>
          </View>
        ))}
      </View>

      {/* Day grid — each date is its own rounded-square badge, not a table cell */}
      {weeks.map((week, rowIndex) => (
        <View
          key={rowIndex}
          style={{ flexDirection: "row", marginBottom: 6 }}
        >
          {week.map((day, colIndex) => {
            if (day === null) {
              return (
                <View key={colIndex} style={{ flex: 1, alignItems: "center" }} />
              );
            }

            const date = new Date(viewYear, viewMonth, day);
            const dateStr = toDateString(date);
            const isToday = date.toDateString() === today.toDateString();
            const isSelected = selectedDate === dateStr;
            const disabled = isUnavailable(date);

            let state = DATE_COLORS.available;
            if (disabled) state = DATE_COLORS.unavailable;
            if (isToday) state = DATE_COLORS.today;
            if (isSelected) state = DATE_COLORS.selected;

            return (
              <View key={colIndex} style={{ flex: 1, alignItems: "center" }}>
                <Pressable disabled={disabled} onPress={() => onDateSelect(dateStr)}>
                  <View
                    style={{
                      width: BADGE_SIZE,
                      height: BADGE_SIZE,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: state.bg,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontWeight: isSelected || isToday ? "700" : "500",
                        color: state.text,
                      }}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}

      {/* Legend */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 14,
          marginTop: 8,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: colors.divider,
        }}
      >
        <LegendSwatch color={DATE_COLORS.available.bg} label="Available" />
        <LegendSwatch color={DATE_COLORS.selected.bg} label="Selected" />
        <LegendSwatch color={DATE_COLORS.today.bg} label="Today" />
        <LegendSwatch color={DATE_COLORS.unavailable.bg} label="Unavailable" />
      </View>

      {/* Selected date banner */}
      {selectedDate ? (
        <View
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: colors.divider,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.success + "1A",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
            }}
          >
            <Ionicons name="calendar" size={18} color={colors.success} />
          </View>
          <View>
            <Text style={{ fontSize: 12, color: colors.text.muted }}>
              Selected date
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontWeight: "700",
                color: colors.text.primary,
                marginTop: 1,
              }}
            >
              {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-PH", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
