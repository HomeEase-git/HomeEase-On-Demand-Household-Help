import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useTabRefreshStore } from "../../store/tabRefreshStore";
import { colors } from "../../constants";

// How long the overlay stays up after a tab-repress. Just long enough to read
// as an intentional "refreshing" beat, not a stall.
const VISIBLE_MS = 450;

export function TabRefreshOverlay() {
  const refreshingTab = useTabRefreshStore((s) => s.refreshingTab);
  const finishRefresh = useTabRefreshStore((s) => s.finishRefresh);

  useEffect(() => {
    if (!refreshingTab) return;
    const timer = setTimeout(finishRefresh, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [refreshingTab, finishRefresh]);

  if (!refreshingTab) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <ActivityIndicator size="large" color={colors.accent.DEFAULT} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    elevation: 999,
  },
});

export default TabRefreshOverlay;
