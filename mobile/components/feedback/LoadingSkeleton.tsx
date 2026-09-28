import React from "react";
import { View } from "react-native";
import {
  SkeletonList,
  BookingCardSkeleton,
  RequestCardSkeleton,
  WorkerCardSkeleton,
} from "../ui/Skeleton";

interface LoadingSkeletonProps {
  type?: "booking" | "request" | "worker" | "search";
  count?: number;
}

const CARD: Record<NonNullable<LoadingSkeletonProps["type"]>, React.FC> = {
  booking: BookingCardSkeleton,
  request: RequestCardSkeleton,
  worker: WorkerCardSkeleton,
  search: WorkerCardSkeleton,
};

/**
 * Placeholder for a card list while it loads. Padded like the FlatLists it
 * stands in for (padding 16), so the cards land exactly where the grey ones
 * were.
 */
export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  type = "booking",
  count = type === "search" ? 5 : 4,
}) => (
  <View className="p-4">
    <SkeletonList count={count} SkeletonComponent={CARD[type]} />
  </View>
);

export default LoadingSkeleton;
