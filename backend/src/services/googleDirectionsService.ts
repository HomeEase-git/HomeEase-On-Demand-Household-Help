// Google Routes API (computeRoutes) — the route drawn on the tracking map.
// Replaces the legacy Directions API. Reuses GOOGLE_MAPS_API_KEY (same Cloud
// project googleDistanceService/googlePlacesService already depend on).
// `TRAFFIC_UNAWARE` keeps this on the cheapest Routes SKU, so durationMin is a
// free-flow estimate, not a live-traffic ETA.
import type { LatLng } from '@utils/geo';

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

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
// Routes API responses carry the route geometry this way instead of raw
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

function toWaypoint(point: LatLng) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lng } } };
}

// Routes API durations are protobuf Duration strings, e.g. "1234s".
function parseDurationSeconds(duration: unknown): number {
  const seconds = typeof duration === 'string' ? parseFloat(duration) : NaN;
  return Number.isFinite(seconds) ? seconds : 0;
}

export async function googleDirections(origin: LatLng, destination: LatLng): Promise<DirectionsResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(COMPUTE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
    });
    const data: any = await response.json();

    const route = data?.routes?.[0];
    if (!response.ok || !route?.polyline?.encodedPolyline) {
      console.error('[googleDirections] request failed:', response.status, data?.error?.message ?? 'no route');
      return null;
    }

    return {
      coordinates: decodePolyline(route.polyline.encodedPolyline),
      distanceKm: (route.distanceMeters ?? 0) / 1000,
      durationMin: parseDurationSeconds(route.duration) / 60,
    };
  } catch (error) {
    console.error('[googleDirections] request threw:', error);
    return null;
  }
}
