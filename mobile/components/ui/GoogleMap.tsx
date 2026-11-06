import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type MapMarker, type MapMarkerProps } from "react-native-maps";
import Constants from "expo-constants";
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

function buildHasMapsKey(): boolean {
  return Constants.expoConfig?.extra?.hasGoogleMapsKey === true;
}

const DESTINATION_COLOR = "#E63946";
const CURRENT_LOCATION_COLOR = "#2A6DF4";
const WORKER_COLOR = "#22C55E";
const ROUTE_COLOR = "rgba(42,109,244,0.85)";
const FIT_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

function Dot({ color, size, halo }: { color: string; size: number; halo?: boolean }) {
  const dot = (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 2, borderColor: "#fff" }}
    />
  );
  if (!halo) return dot;
  const haloSize = size + 8;
  return (
    <View
      style={{
        width: haloSize,
        height: haloSize,
        borderRadius: haloSize / 2,
        backgroundColor: `${color}40`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {dot}
    </View>
  );
}

function DotMarker({ dot, ...markerProps }: Omit<MapMarkerProps, "tracksViewChanges" | "anchor"> & { dot: React.ReactNode }) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracksViewChanges(false), 500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Marker {...markerProps} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracksViewChanges}>
      {dot}
    </Marker>
  );
}

export const GoogleMap = forwardRef<GoogleMapHandle, Props>(function GoogleMap(
  { destination, destinationLabel, currentLocation, workerLocation, workerLabel, routeCoordinates, zoom, onMapReady, style },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  const destinationMarkerRef = useRef<MapMarker>(null);
  const [worker, setWorker] = useState<LatLng | null>(workerLocation ?? null);
  const workerSeenRef = useRef(!!workerLocation);
  const mapReadyRef = useRef(false);

  const route = routeCoordinates && routeCoordinates.length > 1 ? routeCoordinates : null;

  const fitTo = (points: LatLng[]) => {
    if (points.length < 2) return;
    mapRef.current?.fitToCoordinates(points.map(toCoord), { edgePadding: FIT_PADDING, animated: true });
  };

  useImperativeHandle(
    ref,
    () => ({
      updateWorkerLocation: (position: LatLng) => {
        if (!workerSeenRef.current && mapReadyRef.current) fitTo([destination, position]);
        workerSeenRef.current = true;
        setWorker(position);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destination.lat, destination.lng],
  );

  useEffect(() => {
    if (!route || !mapReadyRef.current) return;
    fitTo([destination, ...(worker ? [worker] : []), ...route]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeCoordinates]);

  const handleMapReady = () => {
    mapReadyRef.current = true;
    const points: LatLng[] = [destination];
    if (currentLocation) points.push(currentLocation);
    if (worker) points.push(worker);
    if (route) points.push(...route);
    fitTo(points);
    destinationMarkerRef.current?.showCallout();
    onMapReady?.();
  };

  if (!buildHasMapsKey()) {
    return <MapUnavailable style={style} />;
  }

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={style ?? { flex: 1 }}
      initialCamera={{ center: toCoord(destination), zoom: zoom ?? 15, heading: 0, pitch: 0 }}
      onMapReady={handleMapReady}
      toolbarEnabled={false}
      showsBuildings={false}
      showsIndoors={false}
      rotateEnabled={false}
      pitchEnabled={false}
    >
      <Marker
        ref={destinationMarkerRef}
        coordinate={toCoord(destination)}
        title={destinationLabel ?? "Selected location"}
        pinColor={DESTINATION_COLOR}
      />

      {currentLocation && (
        <DotMarker
          coordinate={toCoord(currentLocation)}
          title="Your location"
          dot={<Dot color={CURRENT_LOCATION_COLOR} size={14} />}
        />
      )}

      {worker && (
        <DotMarker
          coordinate={toCoord(worker)}
          title={workerLabel ?? "Worker's location"}
          dot={<Dot color={WORKER_COLOR} size={16} halo />}
        />
      )}

      {route && <Polyline coordinates={route.map(toCoord)} strokeColor={ROUTE_COLOR} strokeWidth={4} />}
    </MapView>
  );
});

export default GoogleMap;
