import React, { useEffect, useId, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  useWindowDimensions,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  interpolate,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors } from "../../constants/colors";
import { cardShadow } from "../../constants/shadows";

// One clock drives every bar on screen, so all placeholders shimmer as a
// single wave instead of each pulsing out of step on its own JS timer. It runs
// on the UI thread and only while at least one bar is mounted.
const SHIMMER_MS = 1600;
// The sweep uses the first part of each cycle; the rest is a short pause.
const SWEEP_END = 0.7;
const shimmerClock = makeMutable(0);
let mountedBars = 0;

function useShimmerClock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (mountedBars++ === 0) {
      shimmerClock.value = 0;
      shimmerClock.value = withRepeat(
        withTiming(1, { duration: SHIMMER_MS, easing: Easing.inOut(Easing.quad) }),
        -1,
        false,
      );
    }
    return () => {
      if (--mountedBars === 0) cancelAnimation(shimmerClock);
    };
  }, [enabled]);
}

// Soft white highlight that travels across the screen, left to right. Each bar
// shifts its band by its own on-screen x, so the highlight reaches a bar's
// right-hand pill after its left-hand text: one wave, not many.
const ShimmerBand: React.FC<{ offsetX: number }> = ({ offsetX }) => {
  const { width: screenWidth } = useWindowDimensions();
  const bandWidth = Math.round(screenWidth * 0.45);
  const gradientId = `skeleton-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const bandStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          shimmerClock.value,
          [0, SWEEP_END],
          [-bandWidth, screenWidth],
          "clamp",
        ) - offsetX,
      },
    ],
  }), [bandWidth, screenWidth, offsetX]);

  return (
    <Animated.View style={[styles.band, { width: bandWidth }, bandStyle]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.white} stopOpacity={0} />
            <Stop offset="0.5" stopColor={colors.white} stopOpacity={0.65} />
            <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
    </Animated.View>
  );
};

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  marginBottom?: number;
  style?: StyleProp<ViewStyle>;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = "100%",
  height = 12,
  borderRadius = 6,
  marginBottom = 8,
  style,
}) => {
  // Respect the OS "reduce motion" setting: plain grey bars, no sweep.
  const reduceMotion = useReducedMotion();
  useShimmerClock(!reduceMotion);
  const ref = useRef<View>(null);
  const [offsetX, setOffsetX] = useState(0);

  return (
    <View
      ref={ref}
      onLayout={
        reduceMotion ? undefined : () => ref.current?.measureInWindow((x) => setOffsetX(x))
      }
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.bar, { width, height, borderRadius, marginBottom }, style]}
    >
      {!reduceMotion && <ShimmerBand offsetX={offsetX} />}
    </View>
  );
};

// Round placeholder for an avatar or icon.
export const SkeletonCircle: React.FC<{ size: number; marginBottom?: number }> = ({
  size,
  marginBottom = 0,
}) => (
  <Skeleton width={size} height={size} borderRadius={size / 2} marginBottom={marginBottom} />
);

/**
 * Wraps a set of placeholders: announces "Loading" once to screen readers and
 * fades in after a short delay, so a fast response never flashes grey bars.
 */
export const SkeletonGroup: React.FC<{
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}> = ({ children, className, style }) => (
  <Animated.View
    entering={FadeIn.delay(120).duration(220)}
    className={className}
    style={style}
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel="Loading"
  >
    {children}
  </Animated.View>
);

// The card placeholders below mirror the real cards in components/cards
// (bg-card, rounded-2xl, p-4, md avatar) so nothing shifts when data lands.

// Worker Card Skeleton - matches WorkerCard
export const WorkerCardSkeleton: React.FC = () => (
  <View style={[styles.card, styles.row, cardShadow]}>
    <SkeletonCircle size={48} />
    <View style={styles.body}>
      <Skeleton width="60%" height={14} marginBottom={8} />
      <Skeleton width="40%" height={10} marginBottom={8} />
      <Skeleton width="50%" height={10} marginBottom={0} />
    </View>
    <View style={styles.trailing}>
      <Skeleton width={56} height={14} marginBottom={8} />
      <Skeleton width={64} height={18} borderRadius={9} marginBottom={0} />
    </View>
  </View>
);

// Booking Card Skeleton - matches BookingCard / RecordCard
export const BookingCardSkeleton: React.FC = () => (
  <View style={[styles.card, styles.row, cardShadow]}>
    <SkeletonCircle size={40} />
    <View style={styles.body}>
      <Skeleton width="55%" height={14} marginBottom={8} />
      <Skeleton width="40%" height={10} marginBottom={6} />
      <Skeleton width="48%" height={10} marginBottom={0} />
    </View>
    <View style={styles.trailing}>
      <Skeleton width={72} height={18} borderRadius={9} marginBottom={8} />
      <Skeleton width={52} height={14} marginBottom={0} />
    </View>
  </View>
);

// Request Card Skeleton - matches RequestCard (worker's incoming requests)
export const RequestCardSkeleton: React.FC = () => (
  <View style={[styles.card, cardShadow]}>
    <View style={styles.row}>
      <SkeletonCircle size={48} />
      <View style={styles.body}>
        <Skeleton width="55%" height={14} marginBottom={8} />
        <Skeleton width="45%" height={10} marginBottom={6} />
        <Skeleton width="35%" height={10} marginBottom={0} />
      </View>
      <View style={styles.trailing}>
        <Skeleton width={56} height={14} marginBottom={8} />
        <Skeleton width={64} height={18} borderRadius={9} marginBottom={0} />
      </View>
    </View>
    <View style={styles.footer}>
      <Skeleton width="38%" height={10} marginBottom={0} />
      <Skeleton width="18%" height={10} marginBottom={0} />
      <Skeleton width="22%" height={10} marginBottom={0} />
    </View>
  </View>
);

// Transaction Item Skeleton
export const TransactionItemSkeleton: React.FC = () => (
  <View style={styles.transactionItemContainer}>
    <View style={{ flex: 1 }}>
      <Skeleton width="50%" height={10} marginBottom={6} />
      <Skeleton width="70%" height={14} marginBottom={0} />
    </View>
    <Skeleton width={56} height={14} marginBottom={0} />
  </View>
);

// Review Card Skeleton - matches ReviewCard
export const ReviewCardSkeleton: React.FC = () => (
  <View style={[styles.card, cardShadow]}>
    <View style={styles.row}>
      <SkeletonCircle size={48} />
      <View style={styles.body}>
        <Skeleton width="45%" height={14} marginBottom={6} />
        <Skeleton width="28%" height={10} marginBottom={0} />
      </View>
      <Skeleton width={72} height={12} marginBottom={0} />
    </View>
    <View style={{ marginTop: 14 }}>
      <Skeleton width="100%" height={12} />
      <Skeleton width="70%" height={12} marginBottom={0} />
    </View>
  </View>
);

// List Skeleton
export const SkeletonList: React.FC<{
  count?: number;
  SkeletonComponent: React.FC;
  spacing?: number;
}> = ({ count = 3, SkeletonComponent, spacing = 12 }) => (
  <SkeletonGroup>
    {Array.from({ length: count }).map((_, index) => (
      <View key={index} style={{ marginBottom: spacing }}>
        <SkeletonComponent />
      </View>
    ))}
  </SkeletonGroup>
);

// Search Results Skeleton
export const SearchResultsSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <SkeletonList count={count} SkeletonComponent={WorkerCardSkeleton} />
);

// Booking List Skeleton
export const BookingListSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <SkeletonList count={count} SkeletonComponent={BookingCardSkeleton} />
);

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.neutral[200],
    overflow: "hidden",
  },
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  card: {
    backgroundColor: colors.card.DEFAULT,
    borderRadius: 16,
    padding: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  body: {
    flex: 1,
    marginLeft: 12,
  },
  trailing: {
    alignItems: "flex-end",
    marginLeft: 12,
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  transactionItemContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
});
