import React from "react";
import { Pressable, type PressableProps } from "react-native";
import { tap } from "../../utils/feedback";

type Props = PressableProps & {
  className?: string;
  haptic?: boolean;
  inert?: boolean;
};

export const PressableScale: React.FC<Props> = ({
  className = "",
  haptic = false,
  inert = false,
  onPress,
  ...rest
}) => {
  return (
    <Pressable
      {...rest}
      className={
        inert
          ? `${className} active:scale-100`
          : `${className} active:opacity-[0.85] active:scale-[0.97]`
      }
      onPress={
        onPress
          ? (e) => {
              if (haptic && !inert) tap();
              onPress(e);
            }
          : undefined
      }
    />
  );
};

export default PressableScale;
