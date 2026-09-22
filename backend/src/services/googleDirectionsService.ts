// Google Directions API — replaces the OSRM (OpenStreetMap-data-based)
// public routing server previously used for drawing a worker's live route on
// the tracking map. Reuses GOOGLE_MAPS_API_KEY (same Cloud project as
// googleGeocodingService/googleDistanceService already depend on) — the
// Directions API just needs to be enabled alongside Geocoding/Distance Matrix.
import type { LatLng } from '@utils/geo';

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

export type DirectionsResult = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMin: number;
};

export function isGoogleDirectionsConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

// Standard Google encoded-polyline decoding algorithm (the inverse of the
// encoding described at https://developers.google.com/maps/documentation/utilities/polylinealgorithm) —
// Directions API responses carry the route geometry this way instead of raw
// coordinate arrays.
function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }

  return points;
}

function formatLatLng(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

export async function googleDirections(origin: LatLng, destination: LatLng): Promise<DirectionsResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const url = `${DIRECTIONS_URL}?${new URLSearchParams({
    origin: formatLatLng(origin),
    destination: formatLatLng(destination),
    mode: 'driving',
    key: apiKey,
  }).toString()}`;

  try {
    const response = await fetch(url);
    const data: any = await response.json();

    if (data.status !== 'OK' || !data.routes?.length) {
      console.error('[googleDirections] request failed:', data.status, data.error_message);
      return null;
    }

    const route = data.routes[0];
    const legs = route.legs || [];
    const distanceMeters = legs.reduce((sum: number, leg: any) => sum + (leg.distance?.value ?? 0), 0);
    const durationSeconds = legs.reduce((sum: number, leg: any) => sum + (leg.duration?.value ?? 0), 0);

    return {
      coordinates: decodePolyline(route.overview_polyline.points),
      distanceKm: distanceMeters / 1000,
      durationMin: durationSeconds / 60,
    };
  } catch (error) {
    console.error('[googleDirections] request threw:', error);
    return null;
  }
}
