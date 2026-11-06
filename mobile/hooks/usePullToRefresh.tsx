import React, { useCallback, useRef, useState } from "react";
import { RefreshControl } from "react-native";
import { colors } from "../constants";

export function usePullToRefresh(onRefresh: () => unknown) {
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const handleRefresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [onRefresh]);

  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={handleRefresh}
      colors={[colors.brand.DEFAULT]}
      tintColor={colors.brand.DEFAULT}
    />
  );
}
