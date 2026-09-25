import React from "react";
import { Pressable, type PressableProps } from "react-native";
import { tap } from "../../utils/feedback";

type Props = PressableProps & {
  className?: string;
  /** Light vibration on press. Off by default so lists don't buzz on every scroll-tap. */
  haptic?: boolean;
  /**
   * Skip the press effect and haptic. For buttons that look disabled but keep
   * their Pressable enabled (see the Android note in PrimaryButton), so they
   * don't appear to react to a tap that does nothing.
   */
  inert?: boolean;
};

/**
 * Pressable that visibly reacts to touch — slightly shrinks and dims while
 * held — so buttons and cards feel responsive. Uses NativeWind's `active:`
 * variant (driven by the Pressable's own press-in/out), so it needs no
 * animation library and works with any className the caller passes.
 */
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
      // Inert keeps a no-op `active:` class rather than dropping the variant:
      // NativeWind swaps a Pressable's internals when its className gains or
      // loses press states, and remounting a button as it becomes enabled is
      // exactly what the Android touch fix in PrimaryButton avoids.
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
