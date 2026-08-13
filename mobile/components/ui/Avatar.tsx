import React from "react";
import { View, Image } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";

type Props = {
  uri?: string | null;
  size?: "sm" | "md" | "lg";
  name?: string;
  showBadge?: boolean;
};

const SIZE_PX: Record<NonNullable<Props["size"]>, number> = {
  sm: 32,
  md: 48,
  lg: 64,
};

export const Avatar: React.FC<Props> = ({ uri, size = "md", showBadge }) => {
  const containerSizeClass =
    size === "sm" ? "w-8 h-8" : size === "lg" ? "w-16 h-16" : "w-12 h-12";
  const iconSize = size === "sm" ? 16 : size === "lg" ? 28 : 22;
  const pixelSize = SIZE_PX[size];

  return (
    <View
      className={`bg-card items-center justify-center rounded-full overflow-hidden ${containerSizeClass}`}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: pixelSize, height: pixelSize }}
          resizeMode="cover"
        />
      ) : (
        <Ionicons name="person" size={iconSize} color={colors.text.muted} />
      )}
      {showBadge && (
        <View className="w-3 h-3 rounded-full absolute bottom-0 right-0 bg-success" />
      )}
    </View>
  );
};

export default Avatar;
