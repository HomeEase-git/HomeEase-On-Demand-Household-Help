import React from "react";
import { Pressable, Text } from "react-native";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
};

export const DangerButton: React.FC<Props> = ({
  label,
  onPress,
  disabled,
  fullWidth,
}) => {
  return (
    <Pressable
      className={`bg-error rounded-xl py-4 px-6 items-center justify-center ${
        fullWidth ? "w-full" : ""
      } ${disabled ? "opacity-50" : ""}`}
      onPress={onPress}
      disabled={disabled}
    >
      <Text className="text-white font-semibold">{label}</Text>
    </Pressable>
  );
};

export default DangerButton;
