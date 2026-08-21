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
      style={
        disabled
          ? undefined
          : {
              shadowColor: colors.brand.DEFAULT,
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.35,
              shadowRadius: 8,
              elevation: 5,
            }
      }
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text className="text-white font-semibold text-center">{label}</Text>
      )}
    </Pressable>
  );
};

export default PrimaryButton;
