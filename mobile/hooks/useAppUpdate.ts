import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/**
 * Checks for an OTA (eas update) bundle on launch and whenever the app comes
 * back to the foreground. Failures are swallowed: a check must never block the app.
 */
export function useAppUpdate() {
  const [otaAvailable, setOtaAvailable] = useState(false);

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

  return { otaAvailable, installOta };
}
