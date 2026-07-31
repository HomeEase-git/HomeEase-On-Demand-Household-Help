import React, { useEffect, useMemo } from "react";
import { View, Animated, StyleSheet } from "react-native";
import { colors } from "../../constants/colors";

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  marginBottom?: number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  width = "100%",
  height = 12,
  borderRadius = 4,
  marginBottom = 8,
}) => {
  const shimmer = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: false,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: false,
        }),
      ]),
    ).start();
  }, [shimmer]);

  const shimmerOpacity = shimmer.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.3, 0.8, 0.3],
  });

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          marginBottom,
          opacity: shimmerOpacity,
          backgroundColor: colors.card.light,
        } as any,
      ]}
    />
  );
};

// Worker Card Skeleton
export const WorkerCardSkeleton: React.FC = () => {
  return (
    <View style={styles.workerCardContainer}>
      <Skeleton width={60} height={60} borderRadius={30} marginBottom={12} />
      <Skeleton width="80%" height={14} marginBottom={8} />
      <Skeleton width="60%" height={12} marginBottom={8} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Skeleton width="30%" height={10} />
        <Skeleton width="30%" height={10} />
      </View>
    </View>
  );
};

// Booking Card Skeleton
export const BookingCardSkeleton: React.FC = () => {
  return (
    <View style={styles.bookingCardContainer}>
      <View style={styles.bookingCardHeader}>
        <Skeleton width="50%" height={16} marginBottom={0} />
        <Skeleton width="30%" height={14} marginBottom={0} />
      </View>
      <Skeleton width="100%" height={12} marginBottom={12} />
      <View style={styles.bookingCardFooter}>
        <Skeleton width="40%" height={12} marginBottom={0} />
        <Skeleton width="40%" height={12} marginBottom={0} />
      </View>
    </View>
  );
};

// Transaction Item Skeleton
export const TransactionItemSkeleton: React.FC = () => {
  return (
    <View style={styles.transactionItemContainer}>
      <View style={{ flex: 1 }}>
        <Skeleton width="50%" height={10} marginBottom={6} />
        <Skeleton width="70%" height={14} marginBottom={0} />
      </View>
      <Skeleton width={56} height={14} marginBottom={0} />
    </View>
  );
};

// Review Card Skeleton
export const ReviewCardSkeleton: React.FC = () => {
  return (
    <View style={styles.reviewCardContainer}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Skeleton width={40} height={40} borderRadius={20} marginBottom={0} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Skeleton width="40%" height={14} marginBottom={6} />
          <Skeleton width="25%" height={10} marginBottom={0} />
        </View>
        <Skeleton width={70} height={12} marginBottom={0} />
      </View>
      <View style={{ marginTop: 12 }}>
        <Skeleton width="100%" height={12} marginBottom={0} />
      </View>
    </View>
  );
};

// List Skeleton
export const SkeletonList: React.FC<{
  count?: number;
  SkeletonComponent: React.FC;
  spacing?: number;
}> = ({ count = 3, SkeletonComponent, spacing = 12 }) => {
  return (
    <View>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={{ marginBottom: spacing }}>
          <SkeletonComponent />
        </View>
      ))}
    </View>
  );
};

// Search Results Skeleton
export const SearchResultsSkeleton: React.FC = () => {
  return (
    <SkeletonList
      count={5}
      SkeletonComponent={WorkerCardSkeleton}
      spacing={16}
    />
  );
};

// Booking List Skeleton
export const BookingListSkeleton: React.FC = () => {
  return (
    <SkeletonList
      count={4}
      SkeletonComponent={BookingCardSkeleton}
      spacing={12}
    />
  );
};

const styles = StyleSheet.create({
  skeleton: {},
  workerCardContainer: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent.DEFAULT,
  },
  bookingCardContainer: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand.DEFAULT,
  },
  bookingCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  bookingCardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  transactionItemContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  reviewCardContainer: {
    backgroundColor: colors.card.DEFAULT,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
});
