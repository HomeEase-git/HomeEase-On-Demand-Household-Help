import { useCallback, useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { getAppVersionInfo } from "../services/api";
import { storeUpdateNeed } from "../utils/appVersion";

/**
 * Two kinds of update, checked on launch and whenever the app comes back to
 * the foreground. Failures are swallowed: a check must never block the app.
 * - OTA (eas update): a new JS bundle is available for this build.
 * - Store: the installed build is below the admin's latest/minimum version
 *   (GET /api/app/version) and needs a new APK.
 */
export function useAppUpdate() {
  const [otaAvailable, setOtaAvailable] = useState(false);
  const [store, setStore] = useState<{ need: "required" | "optional"; url: string | null } | null>(null);

  const check = useCallback(async () => {
    if (__DEV__) return;
    if (Updates.isEnabled) {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) setOtaAvailable(true);
      } catch {
        // Offline or update server down; try again next foreground.
      }
    }
    // The admin's version settings are Android ones (APK / Play link).
    if (Platform.OS !== "android") return;
    try {
      const info = await getAppVersionInfo();
      const need = storeUpdateNeed(Constants.expoConfig?.version, info);
      setStore(need ? { need, url: info.storeUrl } : null);
    } catch {
      // Same: never block on a failed check.
    }
  }, []);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  const installOta = useCallback(async () => {
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  }, []);

  return { otaAvailable, store, installOta };
}
