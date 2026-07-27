import React from "react";
import { View } from "react-native";
import {
  BookingListSkeleton,
  WorkerCardSkeleton,
  SearchResultsSkeleton,
} from "../ui/Skeleton";

interface LoadingSkeletonProps {
  type?: "booking" | "worker" | "search";
  count?: number;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  type = "booking",
  count = 4,
}) => {
  if (type === "booking") {
    return <BookingListSkeleton />;
  }

  if (type === "search") {
    return <SearchResultsSkeleton />;
  }

  // Worker card type
  return (
    <View className="p-4">
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} className="mb-4">
          <WorkerCardSkeleton />
        </View>
      ))}
    </View>
  );
};

export default LoadingSkeleton;
