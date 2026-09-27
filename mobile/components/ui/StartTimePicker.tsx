import React from "react";
import { View, Text, Pressable } from "react-native";
import { START_TIMES, formatTime12h } from "../../utils/bookingTime";

type Props = {
  value: string | null;
  onChange: (time: string) => void;
  // Times that can be picked (e.g. only later times for a same-day booking).
  // Every START_TIMES entry is shown; ones missing here are greyed out.
  selectable?: string[];
  // Start times already taken on that day (e.g. the pro's other jobs) —
  // still pickable, just marked.
  busyTimes?: string[];
};

/**
 * Hourly start-time chips from 7:00 AM to 6:00 PM (see utils/bookingTime.ts).
 * Replaced the old Morning/Afternoon/Evening slots.
 */
export default function StartTimePicker({ value, onChange, selectable = START_TIMES, busyTimes = [] }: Props) {
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
      {START_TIMES.map((time) => {
        const isSelected = value === time;
        const disabled = !selectable.includes(time);
        const busy = busyTimes.includes(time);
        return (
          <Pressable
            key={time}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected, disabled }}
            accessibilityLabel={`${formatTime12h(time)}${busy ? ", your pro has another job then" : ""}`}
            onPress={() => onChange(time)}
            className={`rounded-xl px-3 py-2.5 border-2 items-center ${
              isSelected ? "bg-accent border-accent" : "bg-card border-transparent"
            } ${disabled ? "opacity-30" : ""}`}
            style={{ width: "23%" }}
          >
            <Text className={`text-sm font-semibold ${isSelected ? "text-white" : "text-text-primary"}`}>
              {formatTime12h(time)}
            </Text>
            {busy && !isSelected && <Text className="text-warning text-[10px] mt-0.5">Busy</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}
