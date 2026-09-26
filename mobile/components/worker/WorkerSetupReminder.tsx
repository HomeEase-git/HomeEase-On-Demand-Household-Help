import React from "react";
import { Pressable, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../icons/AppIcon";
import { colors } from "../../constants";
import { useWorkerSetupStatus } from "../../hooks/useWorkerSetupStatus";

// Height of the bottom tab bar (above the safe-area inset) the reminder sits on.
const TAB_BAR_HEIGHT = 49;

/**
 * Always-visible bar above the worker tab bar until account setup is
 * complete — the worker is hidden from clients and can't accept requests
 * until then. Not dismissible, by design. Hidden on the checklist screen
 * itself, which already shows the same information in full.
 */
export default function WorkerSetupReminder() {
  const { status } = useWorkerSetupStatus();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!status || status.complete || pathname.endsWith("/profile/setup")) return null;

  const left = status.missing.length;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom: insets.bottom + TAB_BAR_HEIGHT }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Finish setting up your profile. ${left} step${left === 1 ? "" : "s"} left.`}
        onPress={() => router.push("/(worker)/profile/setup" as any)}
        className="flex-row items-center px-4 py-2.5"
        style={{ backgroundColor: colors.warning }}
      >
        <Ionicons name="alert-circle" size={18} color={colors.white} />
        <Text className="flex-1 text-white text-sm font-semibold ml-2" numberOfLines={1}>
          Finish setup to receive requests · {left} step{left === 1 ? "" : "s"} left
        </Text>
        <Ionicons name="chevron-forward" size={18} color={colors.white} />
      </Pressable>
    </View>
  );
}
