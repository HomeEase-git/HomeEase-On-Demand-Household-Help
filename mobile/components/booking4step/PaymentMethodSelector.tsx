import React from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

const METHODS = [
  { id: "card", label: "Card", icon: "card-outline" as const },
  { id: "apple_pay", label: "Apple Pay", icon: "logo-apple" as const },
  { id: "google_pay", label: "Google Pay", icon: "logo-google" as const },
  { id: "gcash", label: "GCash", icon: "wallet-outline" as const },
  { id: "maya", label: "Maya", icon: "phone-portrait-outline" as const },
  { id: "bank", label: "Bank Transfer", icon: "business-outline" as const },
  { id: "cash", label: "Cash", icon: "cash-outline" as const },
];

type Props = {
  value: string | null;
  onChange: (id: string) => void;
};

/**
 * Inline payment method grid (Step 4: CONFIRM) — Card/Apple Pay/Google Pay
 * all settle as CARD on the backend (see utils/paymentMethodMap.ts); GCash/
 * Maya go through PayMongo Sources; Bank/Cash are bookkeeping-only. Apple
 * Pay/Google Pay have no separate native SDK wired here — selecting them
 * currently routes through the same card-entry step as "Card" (the
 * distinction is cosmetic until a wallet SDK is integrated).
 */
export default function PaymentMethodSelector({ value, onChange }: Props) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {METHODS.map((method) => {
        const isSelected = value === method.id;
        return (
          <Pressable
            key={method.id}
            onPress={() => onChange(method.id)}
            className={`flex-row items-center rounded-xl px-3.5 py-2.5 border-2 ${
              isSelected ? "bg-accent/10 border-accent" : "bg-card border-transparent"
            }`}
          >
            <Ionicons name={method.icon} size={16} color={isSelected ? colors.accent.DEFAULT : colors.text.secondary} />
            <Text className={`text-sm font-medium ml-2 ${isSelected ? "text-accent" : "text-text-secondary"}`}>
              {method.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
