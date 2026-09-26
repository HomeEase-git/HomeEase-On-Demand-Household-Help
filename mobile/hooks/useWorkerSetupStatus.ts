import { useCallback, useEffect, useState } from "react";
import { usePathname } from "expo-router";
import * as api from "../services/api";
import type { WorkerSetupStatus } from "../services/api";

/**
 * The worker's account-setup checklist (see backend workerSetupService).
 * Re-checked whenever the worker moves to another screen, so finishing an
 * item (e.g. saving a payout method) clears it as soon as they navigate
 * back. Null until the first load.
 */
export function useWorkerSetupStatus() {
  const pathname = usePathname();
  const [status, setStatus] = useState<WorkerSetupStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getMySetupStatus());
    } catch {
      // Keep the last known status; a failed check shouldn't flash the banner.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getMySetupStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return { status, refresh };
}

/** Where the worker goes to finish each setup item. */
export const SETUP_ITEM_ROUTES: Record<api.WorkerSetupItemKey, { path: string; hint: string }> = {
  PROFILE_PHOTO: { path: "/(worker)/profile", hint: "Tap your photo on the Profile tab to add one." },
  PAYOUT_METHOD: { path: "/(worker)/earnings/payout", hint: "Add the GCash or Maya account your earnings go to." },
  ADDRESS: { path: "/(worker)/profile/edit", hint: "Your service base, used for distance fees." },
  AVAILABILITY: { path: "/(worker)/profile/availability", hint: "Open the days and times you can work." },
  SERVICES: { path: "/(worker)/profile/skills", hint: "Tick at least one task you do in an approved service." },
};
