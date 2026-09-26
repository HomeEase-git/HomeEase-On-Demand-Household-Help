// Google Routes API (computeRouteMatrix) — real driving-route distance
// instead of the straight-line (Haversine) fallback in utils/geo.ts, which
// understates the actual km a worker travels on PH road networks (rivers,
// subdivisions, one-way streets, etc.). Replaces the legacy Distance Matrix
// API. Reuses GOOGLE_MAPS_API_KEY — the Routes API just needs to be enabled on
// the same Cloud project. Deliberately uses `TRAFFIC_UNAWARE` routing (the
// cheapest Routes SKU): `distanceMeters` is the route length, which traffic
// doesn't change — this is a static "how far is the route" number, not a live
// "how long will it take" one.
//
// Every function here returns null (per-element or for the whole call) when
// GOOGLE_MAPS_API_KEY isn't set or the request fails, so callers fall back to
// distanceKm's Haversine calculation with no code branching beyond a null
// check — same pattern as googlePlacesService.
import { distanceKm, type LatLng } from '@utils/geo';

const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

// Routes API allows up to 625 elements per TRAFFIC_UNAWARE matrix request;
// with a single origin that's far more than any caller needs, but batched
// callers with more candidates than this (e.g. a large worker search page)
// are still chunked so one oversized page can't fail the whole request.
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

    // Matrix elements come back in no guaranteed order — place each one by
    // its destinationIndex rather than its position in the array. (proto3
    // JSON omits zero-valued fields, so index 0 arrives as undefined.)
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

/**
 * Real driving-route distance (km) from one origin to many destinations, in
 * the same order as `destinations`. A `null` at some index means Google
 * couldn't route that specific pair (or the key isn't configured/the call
 * failed) — the caller should fall back to distanceKm for that pair, not
 * treat it as zero distance.
 */
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

/** Single-pair convenience wrapper over googleDrivingDistancesKm. */
export async function googleDrivingDistanceKm(origin: LatLng, destination: LatLng): Promise<number | null> {
  const [result] = await googleDrivingDistancesKm(origin, [destination]);
  return result ?? null;
}

/**
 * Real driving-route distance (km) from one origin to many destinations,
 * falling back to the Haversine straight-line distance per-destination
 * wherever Google couldn't route that specific pair (or isn't configured at
 * all). Always returns a number for every destination — never null — so
 * callers never need their own fallback branch.
 */
export async function resolveDrivingDistancesKm(origin: LatLng, destinations: LatLng[]): Promise<number[]> {
  const googleResults = await googleDrivingDistancesKm(origin, destinations);
  return destinations.map((destination, i) => googleResults[i] ?? distanceKm(origin, destination));
}

/** Single-pair convenience wrapper over resolveDrivingDistancesKm. */
export async function resolveDrivingDistanceKm(origin: LatLng, destination: LatLng): Promise<number> {
  const [result] = await resolveDrivingDistancesKm(origin, [destination]);
  return result;
}
