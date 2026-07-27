import * as Location from "expo-location";
import type { LatLng } from "../utils/geo";

export class LocationPermissionDeniedError extends Error {
  constructor() {
    super("Location permission denied");
    this.name = "LocationPermissionDeniedError";
  }
}

export async function getCurrentPosition(): Promise<LatLng> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new LocationPermissionDeniedError();
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return { lat: position.coords.latitude, lng: position.coords.longitude };
}
