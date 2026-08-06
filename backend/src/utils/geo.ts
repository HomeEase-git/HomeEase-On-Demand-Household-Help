const EARTH_RADIUS_METERS = 6371000;

export interface LatLng {
  lat: number;
  lng: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates, in meters.
 */
export const distanceMeters = (a: LatLng, b: LatLng): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_METERS * c;
};

export const distanceKm = (a: LatLng, b: LatLng): number => distanceMeters(a, b) / 1000;

export const isWithinRadiusKm = (a: LatLng, b: LatLng, radiusKm: number): boolean =>
  distanceKm(a, b) <= radiusKm;

export const isWithinRadiusMeters = (a: LatLng, b: LatLng, radiusMeters: number): boolean =>
  distanceMeters(a, b) <= radiusMeters;
