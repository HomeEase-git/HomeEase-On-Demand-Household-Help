import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import PrimaryButton from "../ui/PrimaryButton";

const METHODS = [
  { id: "gcash", label: "GCash", icon: "G", bg: "bg-green-500" },
  { id: "maya", label: "Maya", icon: "M", bg: "bg-blue-500" },
  { id: "bank", label: "Bank Transfer", icon: "B", bg: "bg-card-light" },
  { id: "cash", label: "Cash", icon: "₱", bg: "bg-gold/30" },
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
          className={`bg-card-light rounded-xl p-4 mb-2 flex-row items-center ${
            selected === m.id ? "border-2 border-accent" : ""
          }`}
          onPress={() => setSelected(m.id)}
        >
          <View
            className={`w-10 h-10 rounded-full items-center justify-center ${m.bg}`}
          >
            <Text className="text-text-primary font-bold">{m.icon}</Text>
          </View>
          <Text className="text-brand font-semibold ml-3">{m.label}</Text>
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
