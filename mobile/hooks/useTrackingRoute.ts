import { useCallback, useEffect, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { fetchRoute, type LatLng, type RouteResult } from "../utils/geo";
import { shouldRefetchRoute, type LastRouteFetch } from "../utils/trackingRoute";

export type TrackedRoute = RouteResult & { fetchedAt: number };

// Route + ETA from the worker's live position to the booking address. Feed it
// every position; it decides (shouldRefetchRoute) when a new route is worth
// paying for, and only re-renders when one arrives.
export function useTrackingRoute(destination: LatLng | null) {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setIsOnline(s.isConnected ?? true)), []);
  const [route, setRoute] = useState<TrackedRoute | null>(null);
  const [routeFailed, setRouteFailed] = useState(false);
  const lastRef = useRef<LastRouteFetch | null>(null);
  const inFlightRef = useRef(false);

  const destLat = destination?.lat;
  const destLng = destination?.lng;
  const onWorkerPosition = useCallback(
    (position: LatLng) => {
      if (destLat == null || destLng == null || !isOnline || inFlightRef.current) return;
      const now = Date.now();
      if (!shouldRefetchRoute(lastRef.current, position, now)) return;
      lastRef.current = { at: now, from: position };
      inFlightRef.current = true;
      fetchRoute(position, { lat: destLat, lng: destLng })
        .then((result) => {
          if (result && result.coordinates.length > 1) {
            setRoute({ ...result, fetchedAt: Date.now() });
            setRouteFailed(false);
          } else {
            lastRef.current = { at: now, from: null };
            setRouteFailed(true);
          }
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    },
    [destLat, destLng, isOnline],
  );

  return { route, routeFailed, isOnline, onWorkerPosition };
}
