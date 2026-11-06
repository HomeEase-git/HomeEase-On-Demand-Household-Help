import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

export function useAppUpdate() {
  const [otaAvailable, setOtaAvailable] = useState(false);

  const check = useCallback(async () => {
    if (__DEV__) return;
    if (Updates.isEnabled) {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (result.isAvailable) setOtaAvailable(true);
      } catch {
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
