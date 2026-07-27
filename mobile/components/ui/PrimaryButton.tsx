import React from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";
import { colors } from "../../constants";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
};

export const PrimaryButton: React.FC<Props> = ({
  label,
  onPress,
  disabled,
  loading,
  fullWidth,
}) => {
  return (
    <Pressable
      className={`bg-brand rounded-xl py-4 px-6 items-center justify-center ${
        fullWidth ? "w-full" : ""
      } ${disabled ? "opacity-50" : ""}`}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text className="text-white font-semibold">{label}</Text>
      )}
    </Pressable>
  );
};

export default PrimaryButton;
