import * as Location from "expo-location";
import type { LatLng } from "../utils/geo";

export class LocationPermissionDeniedError extends Error {
  constructor() {
    super("Location permission denied");
    this.name = "LocationPermissionDeniedError";
  }
}

export class LocationTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for a GPS fix");
    this.name = "LocationTimeoutError";
  }
}

export type PositionWithAccuracy = LatLng & { accuracy: number | null };

export type ArrivalPosition = PositionWithAccuracy & { mocked: boolean | null };

async function ensurePermission(): Promise<void> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new LocationPermissionDeniedError();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LocationTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function getCurrentPosition(): Promise<ArrivalPosition> {
  await ensurePermission();

  const position = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    12000,
  );

  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
    mocked: position.mocked ?? null,
  };
}

const ACCEPTABLE_ACCURACY_METERS = 20;
const REFINE_WINDOW_MS = 6000;
const OVERALL_TIMEOUT_MS = 20000;

export async function getPrecisePosition(): Promise<PositionWithAccuracy> {
  await ensurePermission();

  return withTimeout(
    new Promise<PositionWithAccuracy>((resolve, reject) => {
      let best: PositionWithAccuracy | null = null;
      let subscription: Location.LocationSubscription | null = null;
      let settled = false;
      let refineTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: PositionWithAccuracy) => {
        if (settled) return;
        settled = true;
        if (refineTimer) clearTimeout(refineTimer);
        subscription?.remove();
        resolve(result);
      };

      const consider = (coords: Location.LocationObjectCoords) => {
        const candidate: PositionWithAccuracy = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy ?? null,
        };
        if (!best || (candidate.accuracy ?? Infinity) < (best.accuracy ?? Infinity)) {
          best = candidate;
        }
        if ((candidate.accuracy ?? Infinity) <= ACCEPTABLE_ACCURACY_METERS) {
          finish(candidate);
        }
      };

      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation })
        .then((position) => {
          consider(position.coords);
          if (settled) return;

          refineTimer = setTimeout(() => {
            if (best) finish(best);
          }, REFINE_WINDOW_MS);

          return Location.watchPositionAsync(
            { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
            (update) => consider(update.coords),
          );
        })
        .then((sub) => {
          if (sub) subscription = sub;
        })
        .catch((error) => {
          if (!settled) {
            settled = true;
            if (refineTimer) clearTimeout(refineTimer);
            reject(error);
          }
        });
    }),
    OVERALL_TIMEOUT_MS,
  );
}

export type LiveLocationUpdate = LatLng & { accuracy: number | null };

export async function watchLiveLocation(
  onUpdate: (position: LiveLocationUpdate) => void,
): Promise<Location.LocationSubscription> {
  await ensurePermission();

  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 8000, distanceInterval: 15 },
    (update) => {
      onUpdate({
        lat: update.coords.latitude,
        lng: update.coords.longitude,
        accuracy: update.coords.accuracy ?? null,
      });
    },
  );
}
