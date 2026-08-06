import React from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { TIME_SLOTS, TIME_SLOT_LABELS, TIME_SLOT_WINDOWS, type TimeSlot } from "../../types/booking4step.types";
import type { SlotCounts } from "../../hooks/useWorkerDiscovery";

const SLOT_ICONS: Record<TimeSlot, string> = {
  MORNING: "sunny-outline",
  AFTERNOON: "partly-sunny-outline",
  EVENING: "moon-outline",
};

type Props = {
  value: TimeSlot | null;
  onChange: (slot: TimeSlot) => void;
  counts?: SlotCounts;
  loadingCounts?: boolean;
};

/**
 * Fixed Morning/Afternoon/Evening slot picker with a live "N pros available"
 * badge per slot (from GET /workers, see useSlotAvailabilityCounts). A slot
 * with 0 available pros is shown but disabled.
 */
export default function TimeSlotPicker({ value, onChange, counts, loadingCounts }: Props) {
  return (
    <View className="gap-2" accessibilityRole="radiogroup">
      {TIME_SLOTS.map((slot) => {
        const isSelected = value === slot;
        const count = counts?.[slot];
        const isKnownEmpty = count === 0;

        return (
          <Pressable
            key={slot}
            disabled={isKnownEmpty}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected, disabled: isKnownEmpty }}
            onPress={() => onChange(slot)}
            className={`flex-row items-center rounded-2xl p-3.5 border-2 ${
              isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
            } ${isKnownEmpty ? "opacity-40" : ""}`}
          >
            <View
              className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                isSelected ? "bg-accent" : "bg-card-light"
              }`}
            >
              <Ionicons
                name={SLOT_ICONS[slot] as any}
                size={20}
                color={isSelected ? colors.white : colors.text.secondary}
              />
            </View>
            <View className="flex-1">
              <Text className={`font-bold text-sm ${isSelected ? "text-accent" : "text-text-primary"}`}>
                {TIME_SLOT_LABELS[slot]}
              </Text>
              <Text className="text-text-muted text-xs mt-0.5">{TIME_SLOT_WINDOWS[slot]}</Text>
            </View>
            {loadingCounts ? (
              <ActivityIndicator size="small" />
            ) : count !== undefined ? (
              <View className={`px-2.5 py-1 rounded-full ${isKnownEmpty ? "bg-error/10" : "bg-success/10"}`}>
                <Text className={`text-xs font-semibold ${isKnownEmpty ? "text-error" : "text-success"}`}>
                  {isKnownEmpty ? "None available" : `${count} pro${count === 1 ? "" : "s"}`}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
