import React, { useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../../components/ui/PrimaryButton";

const METHODS = [
  { id: "gcash", label: "GCash", icon: "G" },
  { id: "maya", label: "Maya", icon: "M" },
  { id: "bank", label: "Bank Transfer", icon: "B" },
];

export default function PayoutEditScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState("gcash");

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Set Payout Method" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        {METHODS.map((m) => (
          <Pressable
            key={m.id}
            className={`bg-card rounded-xl p-4 mb-2 flex-row items-center ${
              selected === m.id ? "border-2 border-accent" : ""
            }`}
            onPress={() => setSelected(m.id)}
          >
            <View className="w-10 h-10 bg-card-light rounded-full items-center justify-center mr-3">
              <Text className="text-text-primary font-bold">{m.icon}</Text>
            </View>
            <Text className="text-brand font-semibold">{m.label}</Text>
          </Pressable>
        ))}
        <PrimaryButton
          label="Save Payout Method"
          fullWidth
          onPress={() => {
            require("react-native").Alert.alert(
              "Saved",
              "Payout method updated",
            );
            router.back();
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
