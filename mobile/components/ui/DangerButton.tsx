import React from "react";
import { Pressable, Text } from "react-native";
import { colors } from "../../constants";

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
      style={
        disabled
          ? undefined
          : {
              shadowColor: colors.error,
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 5,
            }
      }
      onPress={onPress}
      disabled={disabled}
    >
      <Text className="text-white font-semibold text-center">{label}</Text>
    </Pressable>
  );
};

export default DangerButton;
