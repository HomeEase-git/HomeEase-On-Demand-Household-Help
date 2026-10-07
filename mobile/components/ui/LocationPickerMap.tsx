import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import MapView, {
  Circle,
  PROVIDER_GOOGLE,
  type Region,
} from "react-native-maps";
import Constants from "expo-constants";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import {
  getPrecisePosition,
  LocationPermissionDeniedError,
  LocationTimeoutError,
} from "../../services/location";
import {
  reverseGeocodeDetailed,
  type LatLng,
  type PlaceResult,
} from "../../utils/geo";
import MapUnavailable from "./MapUnavailable";

export type LocationPickerMapHandle = {
  animateTo: (coords: LatLng, zoom?: number) => void;
  triggerLocate: () => Promise<void>;
};

type Props = {
  initialLocation?: LatLng | null;
  onLocationSelected?: (location: LatLng, place: PlaceResult | null) => void;
  onLocatingChange?: (locating: boolean) => void;
  /** permissionDenied: true when GPS failed for lack of permission (offer Settings). */
  onError?: (message: string, permissionDenied?: boolean) => void;
  serviceRadiusKm?: number;
  height?: number;
  showLocateButton?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// Check if Maps SDK key is configured (avoids crashes on unconfigured environments)
function buildHasMapsKey(): boolean {
  return Constants.expoConfig?.extra?.hasGoogleMapsKey === true;
}

const DEFAULT_REGION: Region = {
  latitude: 14.5995, // Manila default
  longitude: 120.9842,
  latitudeDelta: 0.005,
  longitudeDelta: 0.005,
};

export const LocationPickerMap = React.forwardRef<
  LocationPickerMapHandle,
  Props
>(function LocationPickerMap(
  {
    initialLocation,
    onLocationSelected,
    onLocatingChange,
    onError,
    serviceRadiusKm,
    height = 280,
    showLocateButton = true,
    style,
    testID = "location-picker-map",
  },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  const [locating, setLocating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [currentCoords, setCurrentCoords] = useState<LatLng>(
    initialLocation ?? {
      lat: DEFAULT_REGION.latitude,
      lng: DEFAULT_REGION.longitude,
    },
  );

  // Each pin move gets a number; a geocode reply for an older move is dropped,
  // so a slow reply can't pull the pin back after a newer drag.
  const pinRequestRef = useRef(0);

  // Subtle lift animation for the center pin when dragging
  const pinElevation = useRef(new Animated.Value(0)).current;

  const liftPin = useCallback(() => {
    Animated.spring(pinElevation, {
      toValue: -10,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [pinElevation]);

  const dropPin = useCallback(() => {
    Animated.spring(pinElevation, {
      toValue: 0,
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [pinElevation]);

  // Forward ref methods
  React.useImperativeHandle(
    ref,
    () => ({
      animateTo: (coords: LatLng, zoom?: number) => {
        const delta = zoom ? 1 / Math.pow(2, zoom - 10) : 0.004;
        mapRef.current?.animateToRegion(
          {
            latitude: coords.lat,
            longitude: coords.lng,
            latitudeDelta: delta,
            longitudeDelta: delta,
          },
          600,
        );
        setCurrentCoords(coords);
      },
      triggerLocate: async () => {
        await handleLocateMe();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleLocateMe = async () => {
    const request = ++pinRequestRef.current;
    setLocating(true);
    onLocatingChange?.(true);
    try {
      const position = await getPrecisePosition();
      const nextCoords: LatLng = { lat: position.lat, lng: position.lng };
      setCurrentCoords(nextCoords);

      // Smoothly glide map under the stationary pin
      mapRef.current?.animateToRegion(
        {
          latitude: position.lat,
          longitude: position.lng,
          latitudeDelta: 0.004,
          longitudeDelta: 0.004,
        },
        700,
      );

      setGeocoding(true);
      const place = await reverseGeocodeDetailed(position.lat, position.lng);
      if (request === pinRequestRef.current) onLocationSelected?.(nextCoords, place);
    } catch (error) {
      let msg = "Unable to get current location.";
      const denied = error instanceof LocationPermissionDeniedError;
      if (denied) {
        msg = "Location permission is required to use GPS.";
      } else if (error instanceof LocationTimeoutError) {
        msg = "GPS timed out. Try moving near an open area or enter manually.";
      }
      onError?.(msg, denied);
    } finally {
      setLocating(false);
      setGeocoding(false);
      onLocatingChange?.(false);
    }
  };

  const handleRegionChange = () => {
    if (!isDragging) {
      setIsDragging(true);
      liftPin();
    }
  };

  const handleRegionChangeComplete = async (
    region: Region,
    details?: { isGesture?: boolean },
  ) => {
    setIsDragging(false);
    dropPin();

    // Only a user's own drag re-pins the location. The map also fires this for
    // its first render and for animateTo (loading a saved pin, picking a
    // search result) — reverse-geocoding those would overwrite the address
    // the caller just set, or silently pin the default Manila region.
    if (details?.isGesture === false) return;

    const nextCoords: LatLng = { lat: region.latitude, lng: region.longitude };
    setCurrentCoords(nextCoords);
    const request = ++pinRequestRef.current;

    setGeocoding(true);
    try {
      const place = await reverseGeocodeDetailed(
        region.latitude,
        region.longitude,
      );
      if (request === pinRequestRef.current) onLocationSelected?.(nextCoords, place);
    } catch (err) {
      console.warn("Reverse geocode on drag failed:", err);
      if (request === pinRequestRef.current) onLocationSelected?.(nextCoords, null);
    } finally {
      if (request === pinRequestRef.current) setGeocoding(false);
    }
  };

  if (Platform.OS !== "web" && !buildHasMapsKey()) {
    return (
      <View style={[{ height }, style]} testID={testID}>
        <MapUnavailable />
      </View>
    );
  }

  const initialRegion: Region = {
    latitude: initialLocation?.lat ?? DEFAULT_REGION.latitude,
    longitude: initialLocation?.lng ?? DEFAULT_REGION.longitude,
    latitudeDelta: DEFAULT_REGION.latitudeDelta,
    longitudeDelta: DEFAULT_REGION.longitudeDelta,
  };

  return (
    <View
      style={[{ height }, style]}
      className="relative w-full rounded-2xl overflow-hidden"
      testID={testID}
    >
      {/* Native Google Map */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onRegionChange={handleRegionChange}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {/* Worker Service Radius Circle if provided */}
        {serviceRadiusKm != null && serviceRadiusKm > 0 && (
          <Circle
            center={{
              latitude: currentCoords.lat,
              longitude: currentCoords.lng,
            }}
            radius={serviceRadiusKm * 1000}
            fillColor="rgba(42, 109, 244, 0.15)"
            strokeColor="#2A6DF4"
            strokeWidth={2}
          />
        )}
      </MapView>

      {/* Stationary Center Pin with Shadow */}
      <View pointerEvents="none" style={styles.centerPinContainer}>
        <Animated.View style={{ transform: [{ translateY: pinElevation }] }}>
          <Ionicons name="location" size={42} color={colors.accent.DEFAULT} />
        </Animated.View>
        {/* Shadow Dot under pin tip */}
        <View
          style={[
            styles.pinShadow,
            {
              transform: [{ scale: isDragging ? 0.7 : 1 }],
              opacity: isDragging ? 0.3 : 0.6,
            },
          ]}
        />
      </View>

      {/* Floating "Locate Me" Button */}
      {showLocateButton && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Locate current position"
          onPress={handleLocateMe}
          disabled={locating}
          className="absolute bottom-4 right-4 w-12 h-12 bg-white rounded-full items-center justify-center shadow-lg"
          style={[styles.locateButton, { elevation: 6 }]}
        >
          {locating ? (
            <ActivityIndicator size="small" color={colors.accent.DEFAULT} />
          ) : (
            <Ionicons name="locate" size={24} color={colors.accent.DEFAULT} />
          )}
        </Pressable>
      )}

      {/* Small subtle status pill in top corner */}
      {geocoding && (
        <View className="absolute top-3 left-3 bg-white/90 rounded-full px-3 py-1 flex-row items-center shadow-sm">
          <ActivityIndicator
            size="small"
            color={colors.accent.DEFAULT}
            style={{ marginRight: 6 }}
          />
          <Text className="text-text-secondary text-xs font-medium">
            Finding address...
          </Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  centerPinContainer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    // Offset slightly so the pin tip points to true center
    marginTop: -20,
  },
  pinShadow: {
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: "#000",
    marginTop: -4,
  },
  locateButton: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});

export default LocationPickerMap;
