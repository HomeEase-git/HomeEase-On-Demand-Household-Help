import React, { forwardRef, useImperativeHandle } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { LatLng } from "../../utils/geo";
import MapUnavailable from "./MapUnavailable";

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
