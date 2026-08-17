import React from "react";
import { Pressable, Text } from "react-native";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
};

export const OutlinedButton: React.FC<Props> = ({
  label,
  onPress,
  disabled,
  fullWidth,
}) => {
  return (
    <Pressable
      className={`bg-white border-2 border-brand rounded-xl py-4 px-6 items-center justify-center ${
        fullWidth ? "w-full" : ""
      } ${disabled ? "opacity-50" : ""}`}
      style={
        disabled
          ? undefined
          : {
              shadowColor: "#000000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.08,
              shadowRadius: 4,
              elevation: 2,
            }
      }
      onPress={onPress}
      disabled={disabled}
    >
      <Text className="text-brand font-semibold text-center">{label}</Text>
    </Pressable>
  );
};

export default OutlinedButton;
