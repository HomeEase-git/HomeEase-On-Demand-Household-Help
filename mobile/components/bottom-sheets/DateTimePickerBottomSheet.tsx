import React, { useState } from "react";
import { Text, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import PrimaryButton from "../ui/PrimaryButton";
import { colors, cardShadow } from "../../constants";

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  mode: "date" | "time";
  onSelect: (value: string) => void;
};

export const DateTimePickerBottomSheet: React.FC<Props> = ({
  innerRef,
  mode,
  onSelect,
}) => {
  const [value, setValue] = useState(mode === "date" ? "2026-03-06" : "09:00");

  const handleConfirm = () => {
    onSelect(value);
    innerRef.current?.close();
  };

  return (
    <BottomSheetWrapper
      innerRef={innerRef}
      snapPoints={["40%"]}
      title={mode === "date" ? "Select date" : "Select time"}
    >
      <Text className="text-text-secondary text-sm mb-4">
        {mode === "date"
          ? "Pick a date (use DateTimePicker in production)"
          : "Pick a time"}
      </Text>
      <Pressable
        className="bg-white rounded-2xl p-4 mb-4 flex-row items-center"
        style={cardShadow}
        onPress={() => setValue(mode === "date" ? "2026-03-07" : "10:00")}
      >
        <Ionicons
          name={mode === "date" ? "calendar-outline" : "time-outline"}
          size={20}
          color={colors.accent.DEFAULT}
        />
        <Text className="text-text-primary font-semibold ml-3">{value}</Text>
      </Pressable>
      <PrimaryButton label="Confirm" fullWidth onPress={handleConfirm} />
    </BottomSheetWrapper>
  );
};

export default DateTimePickerBottomSheet;
