import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import { colors, cardShadow } from "../../constants";

const METHODS = [
  {
    id: "gcash",
    label: "GCash",
    icon: "wallet-outline" as const,
    bg: "bg-green-500",
    iconColor: colors.white,
  },
  {
    id: "maya",
    label: "Maya",
    icon: "phone-portrait-outline" as const,
    bg: "bg-blue-500",
    iconColor: colors.white,
  },
  {
    id: "cash",
    label: "Cash",
    icon: "cash-outline" as const,
    bg: "bg-gold/30",
    iconColor: colors.accent.muted,
  },
];

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  onSelect: (method: string) => void;
};

export const PaymentMethodBottomSheet: React.FC<Props> = ({
  innerRef,
  onSelect,
}) => {
  const [selected, setSelected] = useState<string | null>(null);

  const handleConfirm = () => {
    if (selected) {
      onSelect(selected);
      innerRef.current?.close();
    }
  };

  return (
    <BottomSheetWrapper
      innerRef={innerRef}
      snapPoints={["45%"]}
      title="Payment method"
    >
      {METHODS.map((m) => (
        <Pressable
          key={m.id}
          className={`bg-white rounded-2xl p-4 mb-2 flex-row items-center border-2 ${
            selected === m.id ? "border-accent" : "border-transparent"
          }`}
          style={cardShadow}
          onPress={() => setSelected(m.id)}
        >
          <View
            className={`w-10 h-10 rounded-full items-center justify-center ${m.bg}`}
          >
            <Ionicons name={m.icon} size={20} color={m.iconColor} />
          </View>
          <Text className="text-text-primary font-semibold ml-3 flex-1">
            {m.label}
          </Text>
          {selected === m.id && (
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={colors.accent.DEFAULT}
            />
          )}
        </Pressable>
      ))}
      <View className="mt-4">
        <PrimaryButton
          label="Confirm"
          fullWidth
          disabled={!selected}
          onPress={handleConfirm}
        />
      </View>
    </BottomSheetWrapper>
  );
};

export default PaymentMethodBottomSheet;
