import React from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Animated,
  Easing,
  StyleSheet,
  TouchableWithoutFeedback,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../constants";

export type BottomSheetHandle = {
  expand: () => void;
  close: () => void;
};

type Props = {
  innerRef: React.RefObject<BottomSheetHandle | null>;
  snapPoints: (string | number)[];
  children: React.ReactNode;
  title?: string;
  onClose?: () => void;
};

const ANIMATION_DURATION = 250;
const HIDDEN_OFFSET = 300;

const BottomSheetWrapper: React.FC<Props> = ({
  innerRef,
  snapPoints: _snapPoints, // kept for API compatibility, not used directly
  children,
  title,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const translateY = React.useRef(new Animated.Value(HIDDEN_OFFSET)).current;
  const [visible, setVisible] = React.useState(false);

  const open = React.useCallback(() => {
    setVisible(true);
  }, []);

  const close = React.useCallback(() => {
    Animated.timing(translateY, {
      toValue: HIDDEN_OFFSET,
      duration: ANIMATION_DURATION,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setVisible(false);
        onClose?.();
      }
    });
  }, [onClose, translateY]);

  React.useEffect(() => {
    if (!visible) {
      translateY.setValue(HIDDEN_OFFSET);
      return;
    }

    Animated.timing(translateY, {
      toValue: 0,
      duration: ANIMATION_DURATION,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [visible, translateY]);

  React.useEffect(() => {
    if (!innerRef) return;

    innerRef.current = {
      expand: open,
      close,
    };

    return () => {
      if (innerRef) {
        innerRef.current = null;
      }
    };
  }, [innerRef, open, close]);

  const handleBackdropPress = () => {
    close();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={handleBackdropPress}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}
        >
          <View className="px-4 pb-8 pt-3">
            {title && (
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-text-primary font-bold text-lg">{title}</Text>
                <Pressable onPress={close}>
                  <Ionicons
                    name="close"
                    size={24}
                    color={colors.brand.DEFAULT}
                  />
                </Pressable>
              </View>
            )}
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheet: {
    backgroundColor: colors.card.DEFAULT,
    borderColor: colors.brand.DEFAULT,
    borderWidth: 2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});

export default BottomSheetWrapper;
