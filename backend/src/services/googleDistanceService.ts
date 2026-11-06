import { distanceKm, type LatLng } from '@utils/geo';

const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

const MAX_DESTINATIONS_PER_REQUEST = 100;

export function isGoogleDistanceConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function toWaypoint(point: LatLng) {
  return { waypoint: { location: { latLng: { latitude: point.lat, longitude: point.lng } } } };
}

async function fetchDistanceChunkKm(origin: LatLng, destinations: LatLng[]): Promise<(number | null)[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || destinations.length === 0) return destinations.map(() => null);

  try {
    const response = await fetch(ROUTE_MATRIX_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'destinationIndex,distanceMeters,condition',
      },
      body: JSON.stringify({
        origins: [toWaypoint(origin)],
        destinations: destinations.map(toWaypoint),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      }),
    });
    const data: any = await response.json();

    if (!response.ok || !Array.isArray(data)) {
      console.error('[googleDistance] request failed:', response.status, data?.error?.message ?? data?.[0]?.error?.message);
      return destinations.map(() => null);
    }

    const results: (number | null)[] = destinations.map(() => null);
    for (const element of data) {
      const index = element.destinationIndex ?? 0;
      if (element.condition === 'ROUTE_EXISTS' && typeof element.distanceMeters === 'number') {
        results[index] = element.distanceMeters / 1000;
      }
    }
    return results;
  } catch (error) {
    console.error('[googleDistance] request threw:', error);
    return destinations.map(() => null);
  }
}

export async function googleDrivingDistancesKm(origin: LatLng, destinations: LatLng[]): Promise<(number | null)[]> {
  if (!isGoogleDistanceConfigured() || destinations.length === 0) {
    return destinations.map(() => null);
  }

  const results: (number | null)[] = [];
  for (let i = 0; i < destinations.length; i += MAX_DESTINATIONS_PER_REQUEST) {
    const chunk = destinations.slice(i, i + MAX_DESTINATIONS_PER_REQUEST);
    results.push(...(await fetchDistanceChunkKm(origin, chunk)));
  }
  return results;
}

export async function googleDrivingDistanceKm(origin: LatLng, destination: LatLng): Promise<number | null> {
  const [result] = await googleDrivingDistancesKm(origin, [destination]);
  return result ?? null;
}

export async function resolveDrivingDistancesKm(origin: LatLng, destinations: LatLng[]): Promise<number[]> {
  const googleResults = await googleDrivingDistancesKm(origin, destinations);
  return destinations.map((destination, i) => googleResults[i] ?? distanceKm(origin, destination));
}

export async function resolveDrivingDistanceKm(origin: LatLng, destination: LatLng): Promise<number> {
  const [result] = await resolveDrivingDistancesKm(origin, [destination]);
  return result;
}
