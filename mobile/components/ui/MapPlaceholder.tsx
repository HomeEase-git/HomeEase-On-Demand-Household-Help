import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../constants";

type Props = {
  height?: string;
  label?: string;
};

export const MapPlaceholder: React.FC<Props> = ({
  height = "h-48",
  label = "Map Preview",
}) => {
  return (
    <View
      className={`w-full bg-card-dark rounded-2xl items-center justify-center ${height}`}
    >
      <Ionicons name="map-outline" size={40} color={colors.accent.DEFAULT} />
      <Text className="text-brand mt-2">{label}</Text>
      <Text className="text-text-muted text-xs mt-1">
        Install react-native-maps for live map
      </Text>
    </View>
  );
};

export default MapPlaceholder;
