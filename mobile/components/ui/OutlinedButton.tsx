import React from "react";
import { Text } from "react-native";
import { PressableScale } from "./PressableScale";

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
    <PressableScale
      inert={!!(disabled)}
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
      // Guard in the handler instead of passing `disabled` to Pressable: a
      // Pressable that mounts disabled and is later enabled (e.g. while a
      // screen loads) stops receiving touches on its own surface on Android,
      // leaving only the label tappable.
      onPress={() => {
        if (!(disabled)) onPress();
      }}
      accessibilityState={{ disabled: !!(disabled) }}
    >
      <Text className="text-brand font-semibold text-center" numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
};

export default OutlinedButton;
