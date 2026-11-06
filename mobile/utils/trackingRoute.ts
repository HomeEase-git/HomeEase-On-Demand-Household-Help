import { haversineDistanceKm, type LatLng } from "./geo";

const MIN_INTERVAL_MS = 60_000;
const MIN_MOVE_KM = 0.2;

export type LastRouteFetch = { at: number; from: LatLng | null };

export function shouldRefetchRoute(last: LastRouteFetch | null, position: LatLng, now: number): boolean {
  if (!last) return true;
  if (now - last.at < MIN_INTERVAL_MS) return false;
  return !last.from || haversineDistanceKm(last.from, position) >= MIN_MOVE_KM;
}

export function remainingMinutes(route: { durationMin: number; fetchedAt: number }, now: number): number {
  return Math.max(0, Math.round(route.durationMin - (now - route.fetchedAt) / 60_000));
}
