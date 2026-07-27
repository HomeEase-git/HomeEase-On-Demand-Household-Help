import React from "react";
import { colors } from "../../constants";
import { View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  rating: number;
  size?: number;
  interactive?: boolean;
  onRate?: (value: number) => void;
};

export const StarRating: React.FC<Props> = ({
  rating,
  size = 16,
  interactive,
  onRate,
}) => {
  const stars = Array.from({ length: 5 }).map((_, index) => {
    const value = index + 1;
    const filled = value <= rating;
    const iconComponent = (
      <Ionicons
        name={filled ? "star" : "star-outline"}
        size={size}
        color={filled ? colors.gold : colors.text.muted}
      />
    );

    if (!interactive) {
      return <View key={value}>{iconComponent}</View>;
    }

    return (
      <Pressable key={value} onPress={() => onRate && onRate(value)}>
        {iconComponent}
      </Pressable>
    );
  });

  return <View className="flex-row items-center">{stars}</View>;
};

export default StarRating;
