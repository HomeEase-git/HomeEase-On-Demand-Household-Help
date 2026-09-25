import React, { useCallback, useRef, useState } from "react";
import { RefreshControl } from "react-native";
import { colors } from "../constants";

// Pull-to-refresh for a screen's main ScrollView/FlatList. Pass the same
// loader the screen already hands to useTabRefresh; spread the returned
// element into `refreshControl`. The spinner stays up until the loader
// settles, and overlapping pulls are ignored.
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
      // Screens surface their own load errors; RefreshControl has nowhere
      // to send a rejection, so don't leave one unhandled.
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
