import React from "react";
import { View } from "react-native";
import { Skeleton } from "../ui/Skeleton";

/**
 * Placeholder for a screen whose content is still loading — grey shapes in
 * the rough layout of a detail screen, instead of a lone spinner, so the
 * page doesn't jump when the data arrives. "profile" adds the large header
 * photo the worker profile has.
 */
export const ScreenSkeleton: React.FC<{ variant?: "detail" | "profile" }> = ({ variant = "detail" }) => (
  <View
    className="flex-1"
    accessible
    accessibilityRole="progressbar"
    accessibilityLabel="Loading"
  >
    {variant === "profile" && <Skeleton width="100%" height={256} borderRadius={0} marginBottom={0} />}
    <View className={`px-4 ${variant === "profile" ? "-mt-8" : "pt-4"}`}>
      <View className="bg-card rounded-2xl p-4 mb-3">
        <Skeleton width="55%" height={18} marginBottom={10} />
        <Skeleton width="35%" height={12} marginBottom={0} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} className="bg-card rounded-2xl p-4 mb-3">
          <Skeleton width="40%" height={14} marginBottom={12} />
          <Skeleton width="90%" />
          <Skeleton width="75%" marginBottom={0} />
        </View>
      ))}
    </View>
  </View>
);

export default ScreenSkeleton;
