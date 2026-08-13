import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { URGENCY_LEVELS, URGENCY_LABELS, URGENCY_DESCRIPTIONS, type UrgencyLevel } from "../../types/booking4step.types";

const URGENCY_ICONS: Record<UrgencyLevel, string> = {
  STANDARD: "calendar-outline",
  URGENT: "flash-outline",
  EMERGENCY: "alert-circle-outline",
};

type Props = {
  value: UrgencyLevel;
  onChange: (urgency: UrgencyLevel) => void;
};

/** Single-select urgency picker (Step 2: SCHEDULE) — Standard / Urgent / Emergency. */
export default function UrgencySelector({ value, onChange }: Props) {
  return (
    <View className="gap-2" accessibilityRole="radiogroup">
      {URGENCY_LEVELS.map((urgency) => {
        const isSelected = value === urgency;
        return (
          <Pressable
            key={urgency}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onChange(urgency)}
            className={`flex-row items-center rounded-2xl p-3.5 border-2 ${
              isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
            }`}
          >
            <View
              className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
                isSelected ? "bg-accent" : "bg-card-light"
              }`}
            >
              <Ionicons
                name={URGENCY_ICONS[urgency] as any}
                size={20}
                color={isSelected ? colors.white : colors.text.secondary}
              />
            </View>
            <View className="flex-1">
              <Text className={`font-bold text-sm ${isSelected ? "text-accent" : "text-text-primary"}`}>
                {URGENCY_LABELS[urgency]}
              </Text>
              <Text className="text-text-muted text-xs mt-0.5">{URGENCY_DESCRIPTIONS[urgency]}</Text>
            </View>
            {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.accent.DEFAULT} />}
          </Pressable>
        );
      })}
    </View>
  );
}
