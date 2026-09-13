import React from "react";
import { Pressable, Text, View, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

/** Prominent "auto-assign the top-ranked available worker" CTA (Step 3: WHO). */
export default function SurpriseMeButton({ onPress, loading, disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      className={`rounded-2xl p-4 flex-row items-center justify-center bg-accent mb-4 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          <Ionicons name="flash" size={20} color="#fff" style={{ marginRight: 8 }} />
          <View>
            <Text className="text-white font-bold text-base text-center">Auto-Match Me</Text>
            <Text className="text-white/80 text-xs text-center mt-0.5">
              We&apos;ll assign the best available pro
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
}
