import React, { useEffect } from "react";
import { Modal, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { colors } from "../../constants";

type Props = {
  visible: boolean;
  /** Called once, after the animation has had time to play. */
  onFinish: () => void;
  title?: string;
  subtitle?: string;
  durationMs?: number;
};

const CIRCLE_SIZE = 96;
const SPARK_COUNT = 8;
const SPARK_DISTANCE = 78;

/** One small dot that flies out from the circle's centre and fades. */
function Spark({ index, progress }: { index: number; progress: { value: number } }) {
  const angle = (index / SPARK_COUNT) * Math.PI * 2;
  const style = useAnimatedStyle(() => ({
    opacity: progress.value < 0.15 ? 0 : 1 - progress.value,
    transform: [
      { translateX: Math.cos(angle) * SPARK_DISTANCE * progress.value },
      { translateY: Math.sin(angle) * SPARK_DISTANCE * progress.value },
      { scale: 1 - progress.value * 0.5 },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: index % 2 === 0 ? colors.success : colors.warning,
        },
        style,
      ]}
    />
  );
}

/**
 * Full-screen "you got the job" moment: the circle springs in, the check pops,
 * a ring pulses outward and a few sparks burst. With reduced motion on it shows
 * the finished state with no movement. The caller moves on from `onFinish`,
 * which runs on a plain timer so it never depends on the animation itself.
 */
export default function JobAcceptedCelebration({
  visible,
  onFinish,
  title = "Job Accepted!",
  subtitle = "The client has been notified.",
  durationMs = 1700,
}: Props) {
  const reduceMotion = useReducedMotion();
  const circle = useSharedValue(reduceMotion ? 1 : 0);
  const check = useSharedValue(reduceMotion ? 1 : 0);
  const ring = useSharedValue(0);
  const sparks = useSharedValue(0);
  const text = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (!visible) return;
    if (!reduceMotion) {
      circle.value = 0;
      check.value = 0;
      ring.value = 0;
      sparks.value = 0;
      text.value = 0;
      circle.value = withSpring(1, { damping: 11, stiffness: 140 });
      check.value = withDelay(180, withSpring(1, { damping: 9, stiffness: 180 }));
      ring.value = withDelay(120, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
      sparks.value = withDelay(220, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
      text.value = withDelay(320, withTiming(1, { duration: 350 }));
    }
    const timer = setTimeout(onFinish, durationMs);
    return () => clearTimeout(timer);
    // onFinish is intentionally not a dependency: the timer is armed once per showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: circle.value }] }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: 0.4 + check.value * 0.6 }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ring.value === 0 ? 0 : 0.5 * (1 - ring.value),
    transform: [{ scale: 1 + ring.value * 0.9 }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: text.value,
    transform: [{ translateY: (1 - text.value) * 12 }],
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View
        className="flex-1 items-center justify-center bg-black/50"
        accessibilityViewIsModal
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title} ${subtitle}`}
      >
        <View className="bg-white rounded-3xl px-10 py-8 items-center" style={{ minWidth: 260 }}>
          <View style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE, alignItems: "center", justifyContent: "center" }}>
            <Animated.View
              pointerEvents="none"
              style={[
                {
                  position: "absolute",
                  width: CIRCLE_SIZE,
                  height: CIRCLE_SIZE,
                  borderRadius: CIRCLE_SIZE / 2,
                  backgroundColor: colors.success,
                },
                ringStyle,
              ]}
            />
            {!reduceMotion &&
              Array.from({ length: SPARK_COUNT }, (_, i) => <Spark key={i} index={i} progress={sparks} />)}
            <Animated.View
              style={[
                {
                  width: CIRCLE_SIZE,
                  height: CIRCLE_SIZE,
                  borderRadius: CIRCLE_SIZE / 2,
                  backgroundColor: colors.success,
                  alignItems: "center",
                  justifyContent: "center",
                },
                circleStyle,
              ]}
            >
              <Animated.View style={checkStyle}>
                <Ionicons name="checkmark" size={56} color="#FFFFFF" />
              </Animated.View>
            </Animated.View>
          </View>
          <Animated.View style={[{ alignItems: "center", marginTop: 20 }, textStyle]}>
            <Text className="text-text-primary text-xl font-bold">{title}</Text>
            <Text className="text-text-secondary text-sm mt-1 text-center">{subtitle}</Text>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}
