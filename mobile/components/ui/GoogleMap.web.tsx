import React, { forwardRef, useImperativeHandle } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { LatLng } from "../../utils/geo";
import MapUnavailable from "./MapUnavailable";

// Web stand-in for GoogleMap.tsx: react-native-maps is native-only, and the
// app ships on Android only, so the web build (used for quick UI checks)
// just shows the placeholder with the same props and handle.

export type GoogleMapHandle = {
  updateWorkerLocation: (position: LatLng) => void;
};

type Props = {
  destination: LatLng;
  destinationLabel?: string;
  currentLocation?: LatLng | null;
  workerLocation?: LatLng | null;
  workerLabel?: string;
  routeCoordinates?: LatLng[];
  zoom?: number;
  onMapReady?: () => void;
  style?: StyleProp<ViewStyle>;
};

export const GoogleMap = forwardRef<GoogleMapHandle, Props>(function GoogleMap({ style }, ref) {
  useImperativeHandle(ref, () => ({ updateWorkerLocation: () => {} }), []);
  return <MapUnavailable style={style} />;
});

export default GoogleMap;
