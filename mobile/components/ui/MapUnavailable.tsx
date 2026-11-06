import React from "react";
import { StyleProp, Text, View, ViewStyle } from "react-native";
import { colors } from "../../constants";
import { AppIcon as Ionicons } from "../icons/AppIcon";

export default function MapUnavailable({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style ?? { flex: 1 }} className="bg-card-dark items-center justify-center px-4">
      <Ionicons name="map-outline" size={32} color={colors.accent.DEFAULT} />
      <Text className="text-brand mt-2 text-xs text-center">Map unavailable in this build.</Text>
    </View>
  );
}
