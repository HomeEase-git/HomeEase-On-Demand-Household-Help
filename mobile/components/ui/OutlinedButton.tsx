import React from "react";
import { Pressable, Text } from "react-native";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

export const OutlinedButton: React.FC<Props> = ({
  label,
  onPress,
  disabled,
}) => {
  return (
    <Pressable
      className={`border-2 border-brand rounded-xl py-4 px-6 items-center justify-center ${
        disabled ? "opacity-50" : ""
      }`}
      onPress={onPress}
      disabled={disabled}
    >
      <Text className="text-brand font-semibold">{label}</Text>
    </Pressable>
  );
};

export default OutlinedButton;
