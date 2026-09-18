import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import type { ServiceTaskOption } from "../../types/booking4step.types";

type Props = {
  tasks: ServiceTaskOption[];
  selectedId: string | null;
  onSelect: (task: ServiceTaskOption) => void;
};

function taskPriceLabel(task: ServiceTaskOption): string {
  if (task.pricingModel === "CUSTOM_QUOTE") return "Quote after inspection";
  const suffix = task.pricingModel === "PER_UNIT" || task.pricingModel === "TIERED" ? `/${task.unitLabel}` : "";
  if (task.minPrice == null || task.maxPrice == null) return "";
  return task.minPrice === task.maxPrice
    ? `~₱${task.minPrice}${suffix}`
    : `₱${task.minPrice} – ₱${task.maxPrice}${suffix}`;
}

/**
 * List-style task picker shown once a category is selected (Step 1) —
 * lets the client pick the specific job (e.g. "Toilet Repair" under
 * "Plumbing Repair") a worker prices individually, instead of booking the
 * whole category at one flat admin price.
 */
export default function TaskSelector({ tasks, selectedId, onSelect }: Props) {
  return (
    <View accessibilityRole="radiogroup">
      {tasks.map((task) => {
        const isSelected = task.id === selectedId;
        return (
          <Pressable
            key={task.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(task)}
            className={`rounded-2xl p-3.5 mb-2 border-2 flex-row items-center justify-between ${
              isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
            }`}
          >
            <View className="flex-1 pr-3">
              <Text className={`font-semibold text-sm ${isSelected ? "text-accent" : "text-text-primary"}`}>
                {task.name}
              </Text>
              {!!task.description && (
                <Text className="text-text-muted text-xs mt-0.5" numberOfLines={2}>
                  {task.description}
                </Text>
              )}
              <Text className="text-text-secondary text-xs mt-1 font-medium">{taskPriceLabel(task)}</Text>
            </View>
            {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.accent.DEFAULT} />}
          </Pressable>
        );
      })}
    </View>
  );
}
