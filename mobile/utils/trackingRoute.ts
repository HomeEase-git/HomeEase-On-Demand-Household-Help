import { haversineDistanceKm, type LatLng } from "./geo";

// Google Routes calls cost money, so live tracking refetches the route only
// when both enough time has passed and the worker has actually moved.
const MIN_INTERVAL_MS = 60_000;
const MIN_MOVE_KM = 0.2;

// `from` is where the last successful route started; null after a failed
// request, so a parked worker still gets a retry once the interval passes.
export type LastRouteFetch = { at: number; from: LatLng | null };

export function shouldRefetchRoute(last: LastRouteFetch | null, position: LatLng, now: number): boolean {
  if (!last) return true;
  if (now - last.at < MIN_INTERVAL_MS) return false;
  return !last.from || haversineDistanceKm(last.from, position) >= MIN_MOVE_KM;
}

/** Minutes left on a route's ETA, counted down from when it was fetched. */
export function remainingMinutes(route: { durationMin: number; fetchedAt: number }, now: number): number {
  return Math.max(0, Math.round(route.durationMin - (now - route.fetchedAt) / 60_000));
}
