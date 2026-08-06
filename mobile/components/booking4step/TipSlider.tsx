import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import InputField from "../ui/InputField";

const PRESETS = [0, 10, 15, 20];

type Props = {
  value: number;
  onChange: (amount: number) => void;
};

/** Tip preset buttons ($0/$10/$15/$20) + custom input (Step 4: CONFIRM). */
export default function TipSlider({ value, onChange }: Props) {
  const isPreset = PRESETS.includes(value);
  const [showCustom, setShowCustom] = useState(!isPreset && value > 0);
  const [customText, setCustomText] = useState(isPreset ? "" : value > 0 ? String(value) : "");

  return (
    <View>
      <View className="flex-row gap-2 flex-wrap">
        {PRESETS.map((amount) => {
          const isSelected = !showCustom && value === amount;
          return (
            <Pressable
              key={amount}
              onPress={() => {
                setShowCustom(false);
                setCustomText("");
                onChange(amount);
              }}
              className={`rounded-xl px-4 py-2 ${isSelected ? "bg-accent" : "bg-card"}`}
            >
              <Text className={`text-sm font-semibold ${isSelected ? "text-white" : "text-text-secondary"}`}>
                {amount === 0 ? "No Tip" : `₱${amount}`}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setShowCustom(true)}
          className={`rounded-xl px-4 py-2 ${showCustom ? "bg-accent" : "bg-card"}`}
        >
          <Text className={`text-sm font-semibold ${showCustom ? "text-white" : "text-text-secondary"}`}>
            Custom
          </Text>
        </Pressable>
      </View>

      {showCustom && (
        <View className="mt-3">
          <InputField
            label=""
            value={customText}
            onChangeText={(text) => {
              setCustomText(text);
              const parsed = parseFloat(text);
              onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
            }}
            placeholder="Enter custom tip amount"
            keyboardType="numeric"
          />
        </View>
      )}
    </View>
  );
}
