// Google Distance Matrix API — real driving-route distance instead of the
// straight-line (Haversine) fallback in utils/geo.ts, which understates the
// actual km a worker travels on PH road networks (rivers, subdivisions,
// one-way streets, etc.). Reuses GOOGLE_MAPS_API_KEY (googleGeocodingService
// already depends on it being set up) — the Distance Matrix API just needs
// to be enabled on the same Cloud project. Deliberately does NOT pass
// `departure_time`/`traffic_model`: the `distance.value` Google returns is
// the route length for the given `mode`, not a traffic-adjusted figure (that
// only affects `duration`, which this never requests) — so this is a static
// "how far is the route" number, not a live "how long will it take" one.
//
// Every function here returns null (per-element or for the whole call) when
// GOOGLE_MAPS_API_KEY isn't set or the request fails, so callers fall back to
// distanceKm's Haversine calculation with no code branching beyond a null
// check — same pattern as googleGeocodingService.
import { distanceKm, type LatLng } from '@utils/geo';

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';

// Google caps a single Distance Matrix request at 25 destinations (and 100
// elements) per origin — batched callers with more candidates than this
// (e.g. a large worker search page) are chunked into multiple requests.
const MAX_DESTINATIONS_PER_REQUEST = 25;

export function isGoogleDistanceConfigured(): boolean {
  return !!process.env.GOOGLE_MAPS_API_KEY;
}

function formatLatLng(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

async function fetchDistanceChunkKm(origin: LatLng, destinations: LatLng[]): Promise<(number | null)[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || destinations.length === 0) return destinations.map(() => null);

  const url = `${DISTANCE_MATRIX_URL}?${new URLSearchParams({
    origins: formatLatLng(origin),
    destinations: destinations.map(formatLatLng).join('|'),
    mode: 'driving',
    units: 'metric',
    key: apiKey,
  }).toString()}`;

  try {
    const response = await fetch(url);
    const data: any = await response.json();

    if (data.status !== 'OK' || !data.rows?.[0]?.elements) {
      console.error('[googleDistance] request failed:', data.status, data.error_message);
      return destinations.map(() => null);
    }

    return data.rows[0].elements.map((element: any) =>
      element.status === 'OK' && typeof element.distance?.value === 'number'
        ? element.distance.value / 1000
        : null
    );
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
