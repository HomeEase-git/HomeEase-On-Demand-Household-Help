import React, { forwardRef } from "react";
import {
  KeyboardAwareScrollView as BaseKeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
  type KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import { cssInterop } from "nativewind";

cssInterop(BaseKeyboardAwareScrollView, {
  className: "style",
  contentContainerClassName: "contentContainerStyle",
});

type Props = KeyboardAwareScrollViewProps & {
  className?: string;
  contentContainerClassName?: string;
};

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
