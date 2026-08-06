import React from "react";
import { View, Text, Pressable } from "react-native";
import { PRIORITY_OPTIONS, MAX_PRIORITIES } from "../../types/booking4step.types";

type Props = {
  selected: string[];
  onChange: (selected: string[]) => void;
};

/** Priority chips — max MAX_PRIORITIES selections (Step 4: CONFIRM). */
export default function PrioritySelector({ selected, onChange }: Props) {
  const toggle = (priority: string) => {
    if (selected.includes(priority)) {
      onChange(selected.filter((p) => p !== priority));
      return;
    }
    if (selected.length >= MAX_PRIORITIES) return;
    onChange([...selected, priority]);
  };

  return (
    <View>
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-text-primary font-bold text-sm">What matters most?</Text>
        <Text className="text-text-muted text-xs">
          {selected.length}/{MAX_PRIORITIES} selected
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {PRIORITY_OPTIONS.map((priority) => {
          const isSelected = selected.includes(priority);
          const isDisabled = !isSelected && selected.length >= MAX_PRIORITIES;
          return (
            <Pressable
              key={priority}
              disabled={isDisabled}
              onPress={() => toggle(priority)}
              className={`rounded-full px-4 py-2 border ${
                isSelected ? "bg-accent border-accent" : "bg-card border-divider"
              } ${isDisabled ? "opacity-40" : ""}`}
            >
              <Text className={`text-sm font-medium ${isSelected ? "text-white" : "text-text-secondary"}`}>
                {priority}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
