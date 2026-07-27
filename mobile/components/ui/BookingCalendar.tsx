import React, { useState, useEffect } from "react";
import { View, Text, Pressable } from "react-native";
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

const toDateString = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function BookingCalendar({
  unavailableDates = [],
  workerOffDays = [0, 6], // defaults to Sat/Sun off
  selectedDate,
  onDateSelect,
}: Props) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const minDate = new Date(today);
  minDate.setDate(today.getDate() + 2); // 2-day lead time

  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 90); // 90-day cap

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

  const firstDayOffset = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  return (
    <View
      style={{
        backgroundColor: colors.card.DEFAULT,
        borderRadius: 16,
        borderWidth: 0.5,
        borderColor: colors.divider,
        padding: 16,
        marginBottom: 16,
      }}
    >
      {/* Month navigation */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <Pressable
          onPress={goToPrevMonth}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.brand.DEFAULT, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text
          style={{
            fontSize: 15,
            fontWeight: "500",
            color: colors.text.primary,
          }}
        >
          {MONTHS[viewMonth]} {viewYear}
        </Text>
        <Pressable
          onPress={goToNextMonth}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.surface,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.brand.DEFAULT, fontSize: 16 }}>›</Text>
        </Pressable>
      </View>

      {/* Day headers */}
      <View style={{ flexDirection: "row", marginBottom: 6 }}>
        {DAYS.map((d) => (
          <View key={d} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 11, color: colors.text.muted }}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Day grid */}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {/* Empty offset cells */}
        {Array.from({ length: firstDayOffset }).map((_, i) => (
          <View
            key={`empty-${i}`}
            style={{ width: `${100 / 7}%`, aspectRatio: 1 }}
          />
        ))}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const date = new Date(viewYear, viewMonth, day);
          const dateStr = toDateString(date);
          const isToday = date.toDateString() === today.toDateString();
          const isSelected = selectedDate === dateStr;
          const disabled = isUnavailable(date);

          return (
            <View
              key={day}
              style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}
            >
              <Pressable
                disabled={disabled}
                onPress={() => onDateSelect(dateStr)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 99,
                  backgroundColor: isSelected
                    ? colors.brand.DEFAULT
                    : "transparent",
                  borderWidth: isToday && !isSelected ? 1.5 : 0,
                  borderColor: colors.brand.DEFAULT,
                  opacity: disabled ? 0.3 : 1,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: isSelected || isToday ? "500" : "400",
                    color: isSelected
                      ? colors.white
                      : disabled
                        ? colors.text.muted
                        : colors.text.primary,
                    textDecorationLine: disabled ? "line-through" : "none",
                  }}
                >
                  {day}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Selected date banner */}
      {selectedDate ? (
        <View
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTopWidth: 0.5,
            borderTopColor: colors.divider,
          }}
        >
          <Text style={{ fontSize: 12, color: colors.text.muted }}>
            Selected date
          </Text>
          <Text
            style={{
              fontSize: 14,
              fontWeight: "500",
              color: colors.accent.DEFAULT,
              marginTop: 2,
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
      ) : null}
    </View>
  );
}
