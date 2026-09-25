import React, { forwardRef } from "react";
import {
  KeyboardAwareScrollView as BaseKeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
  type KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import { cssInterop } from "nativewind";

// NativeWind only maps className -> style on components it knows about, and
// this one isn't a core React Native component.
cssInterop(BaseKeyboardAwareScrollView, {
  className: "style",
  contentContainerClassName: "contentContainerStyle",
});

type Props = KeyboardAwareScrollViewProps & {
  className?: string;
  contentContainerClassName?: string;
};

/**
 * Drop-in replacement for a form screen's vertical ScrollView: when a field
 * is focused, it scrolls just enough to keep that field above the keyboard.
 *
 * Defaults (all overridable):
 * - bottomOffset: breathing room between the field and the keyboard.
 * - keyboardShouldPersistTaps "handled": the first tap on a button while the
 *   keyboard is open presses it (instead of only closing the keyboard), and
 *   tapping empty space still closes the keyboard.
 * - keyboardDismissMode "on-drag": scrolling the form puts the keyboard away.
 */
export const KeyboardAwareScrollView = forwardRef<KeyboardAwareScrollViewRef, Props>(
  (props, ref) => (
    <BaseKeyboardAwareScrollView
      ref={ref}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...props}
    />
  ),
);

KeyboardAwareScrollView.displayName = "KeyboardAwareScrollView";

export default KeyboardAwareScrollView;
