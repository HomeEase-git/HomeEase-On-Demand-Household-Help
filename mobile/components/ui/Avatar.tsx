import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Props = {
  size?: "sm" | "md" | "lg";
  name?: string;
  showBadge?: boolean;
};

export const Avatar: React.FC<Props> = ({ size = "md", showBadge }) => {
  const containerSizeClass =
    size === "sm" ? "w-8 h-8" : size === "lg" ? "w-16 h-16" : "w-12 h-12";
  const iconSize = size === "sm" ? 16 : size === "lg" ? 28 : 22;

  return (
    <View
      className={`bg-card items-center justify-center rounded-full ${containerSizeClass}`}
    >
      {/* TODO: Replace with actual image using expo-image */}
      <Ionicons name="person" size={iconSize} color={colors.text.muted} />
      {showBadge && (
        <View className="w-3 h-3 rounded-full absolute bottom-0 right-0 bg-success" />
      )}
    </View>
  );
};

export default Avatar;
