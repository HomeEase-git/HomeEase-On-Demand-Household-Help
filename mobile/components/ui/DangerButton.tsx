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

export const DangerButton: React.FC<Props> = ({
  label,
  onPress,
  disabled,
  loading,
  fullWidth,
}) => {
  return (
    <Pressable
      className={`bg-error border-2 border-transparent rounded-xl py-4 px-6 items-center justify-center ${
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
      // Guard in the handler instead of passing `disabled` to Pressable: a
      // Pressable that mounts disabled and is later enabled (e.g. while a
      // screen loads) stops receiving touches on its own surface on Android,
      // leaving only the label tappable.
      onPress={() => {
        if (!(disabled || loading)) onPress();
      }}
      accessibilityState={{ disabled: !!(disabled || loading) }}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text className="text-white font-semibold text-center" numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
};

export default DangerButton;
