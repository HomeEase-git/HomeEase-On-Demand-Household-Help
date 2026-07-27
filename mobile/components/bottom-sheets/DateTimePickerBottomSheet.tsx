import React, { useState } from "react";
import { View, Text, Pressable } from "react-native";
import BottomSheetWrapper, { BottomSheetHandle } from "./BottomSheetWrapper";
import PrimaryButton from "../ui/PrimaryButton";

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
      <Text className="text-brand mb-4">
        {mode === "date"
          ? "Pick a date (use DateTimePicker in production)"
          : "Pick a time"}
      </Text>
      <Pressable
        className="bg-card-light rounded-xl p-4 mb-4"
        onPress={() => setValue(mode === "date" ? "2026-03-07" : "10:00")}
      >
        <Text className="text-brand">{value}</Text>
      </Pressable>
      <PrimaryButton label="Confirm" fullWidth onPress={handleConfirm} />
    </BottomSheetWrapper>
  );
};

export default DateTimePickerBottomSheet;
