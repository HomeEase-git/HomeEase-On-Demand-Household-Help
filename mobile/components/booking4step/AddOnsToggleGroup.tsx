import React from "react";
import { View, Text, Switch } from "react-native";
import { colors } from "../../constants";
import { ADD_ON_TOGGLES, type AddOnToggleKey } from "../../types/booking4step.types";

type Props = {
  selected: string[];
  onChange: (selected: string[]) => void;
};

/**
 * Free job-preference toggles (Step 4: CONFIRM) — distinct from the priced
 * add-ons picked in Step 1's category flow. Sent to the backend as
 * zero-priced BookingAddOn entries (see step-4.tsx) so the worker can see
 * them, since the schema has no dedicated boolean fields for these.
 */
export default function AddOnsToggleGroup({ selected, onChange }: Props) {
  const toggle = (key: AddOnToggleKey) => {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <View className="gap-2">
      {ADD_ON_TOGGLES.map(({ key, label, description }) => {
        const isOn = selected.includes(key);
        return (
          <View key={key} className="bg-card rounded-xl p-3.5 flex-row items-center">
            <View className="flex-1 pr-3">
              <Text className="text-text-primary font-semibold text-sm">{label}</Text>
              <Text className="text-text-muted text-xs mt-0.5">{description}</Text>
            </View>
            <Switch
              value={isOn}
              onValueChange={() => toggle(key)}
              trackColor={{ false: colors.toggleOff, true: colors.accent.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
        );
      })}
    </View>
  );
}
