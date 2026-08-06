import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { CONDITION_TYPES, CONDITION_LABELS, CONDITION_DESCRIPTIONS, type ConditionType } from "../../types/booking4step.types";

const CONDITION_ICONS: Record<ConditionType, string> = {
  TIDY: "happy-outline",
  NORMAL: "home-outline",
  HEAVY: "warning-outline",
};

type Props = {
  value: ConditionType | null;
  onChange: (condition: ConditionType) => void;
};

/** Single-select condition picker (Step 1: SCOPE) — Tidy / Normal / Heavy. */
export default function ConditionSelector({ value, onChange }: Props) {
  return (
    <View className="gap-2" accessibilityRole="radiogroup">
      {CONDITION_TYPES.map((condition) => {
        const isSelected = value === condition;
        return (
          <Pressable
            key={condition}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onChange(condition)}
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
                name={CONDITION_ICONS[condition] as any}
                size={20}
                color={isSelected ? colors.white : colors.text.secondary}
              />
            </View>
            <View className="flex-1">
              <Text className={`font-bold text-sm ${isSelected ? "text-accent" : "text-text-primary"}`}>
                {CONDITION_LABELS[condition]}
              </Text>
              <Text className="text-text-muted text-xs mt-0.5">{CONDITION_DESCRIPTIONS[condition]}</Text>
            </View>
            {isSelected && <Ionicons name="checkmark-circle" size={22} color={colors.accent.DEFAULT} />}
          </Pressable>
        );
      })}
    </View>
  );
}
