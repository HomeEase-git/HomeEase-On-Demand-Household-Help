import React from "react";
import { View } from "react-native";
import { Skeleton, SkeletonCircle, SkeletonGroup } from "../ui/Skeleton";

/**
 * Placeholder for a screen whose content is still loading — grey shapes in
 * the rough layout of a detail screen, instead of a lone spinner, so the
 * page doesn't jump when the data arrives. "profile" adds the large header
 * photo the worker profile has.
 */
export const ScreenSkeleton: React.FC<{ variant?: "detail" | "profile" }> = ({ variant = "detail" }) => (
  <SkeletonGroup className="flex-1">
    {variant === "profile" && <Skeleton width="100%" height={256} borderRadius={0} marginBottom={0} />}
    <View className={`px-4 ${variant === "profile" ? "-mt-8" : "pt-4"}`}>
      <View className="bg-card rounded-2xl p-4 mb-3 flex-row items-center">
        <SkeletonCircle size={48} />
        <View className="flex-1 ml-3">
          <Skeleton width="55%" height={18} marginBottom={10} />
          <Skeleton width="35%" height={12} marginBottom={0} />
        </View>
        <Skeleton width={72} height={20} borderRadius={10} marginBottom={0} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} className="bg-card rounded-2xl p-4 mb-3">
          <Skeleton width="40%" height={14} marginBottom={14} />
          {[0, 1].map((row) => (
            <View key={row} className="flex-row justify-between items-center mb-3">
              <Skeleton width="35%" marginBottom={0} />
              <Skeleton width="30%" marginBottom={0} />
            </View>
          ))}
          <Skeleton width="75%" marginBottom={0} />
        </View>
      ))}
    </View>
  </SkeletonGroup>
);

export default ScreenSkeleton;
