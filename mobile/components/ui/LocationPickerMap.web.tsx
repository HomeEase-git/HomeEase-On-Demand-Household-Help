import React from "react";
import { StyleProp, Text, View, ViewStyle, Pressable } from "react-native";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import type { LatLng, PlaceResult } from "../../utils/geo";

export type LocationPickerMapHandle = {
  animateTo: (coords: LatLng, zoom?: number) => void;
  triggerLocate: () => Promise<void>;
};

type Props = {
  initialLocation?: LatLng | null;
  onLocationSelected?: (location: LatLng, place: PlaceResult | null) => void;
  onLocatingChange?: (locating: boolean) => void;
  onError?: (message: string) => void;
  serviceRadiusKm?: number;
  height?: number;
  showLocateButton?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export const LocationPickerMap = React.forwardRef<
  LocationPickerMapHandle,
  Props
>(function LocationPickerMap(
  { height = 280, style, testID = "location-picker-map" },
  ref,
) {
  React.useImperativeHandle(
    ref,
    () => ({
      animateTo: () => {},
      triggerLocate: async () => {},
    }),
    [],
  );

  return (
    <View
      style={[{ height }, style]}
      className="bg-card-dark items-center justify-center rounded-2xl px-4 border border-divider"
      testID={testID}
    >
      <Ionicons name="map-outline" size={36} color={colors.accent.DEFAULT} />
      <Text className="text-brand font-semibold mt-2 text-sm text-center">
        Interactive Pin Map
      </Text>
      <Text className="text-text-muted text-xs text-center mt-1">
        Interactive map gestures and GPS location are enabled on mobile devices.
      </Text>
    </View>
  );
});

export default LocationPickerMap;
