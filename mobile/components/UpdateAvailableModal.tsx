import React, { useState } from "react";
import { View, Text } from "react-native";
import { usePathname } from "expo-router";
import { AppIcon as Ionicons } from "./icons/AppIcon";
import ModalWrapper from "./modals/ModalWrapper";
import PrimaryButton from "./ui/PrimaryButton";
import OutlinedButton from "./ui/OutlinedButton";
import { useAppUpdate } from "../hooks/useAppUpdate";
import { colors } from "../constants";

// Tab home screens and sign-in: places where a prompt can't interrupt a
// booking, checkout, or form. 
const IDLE_PATHS = new Set(["/", "/sign-in", "/home", "/category", "/booking", "/inbox", "/profile", "/requests", "/records", "/earnings"]);

/** Mounted once in the root layout; see useAppUpdate for what triggers it. */
export default function UpdateAvailableModal() {
  const pathname = usePathname();
  const { otaAvailable, installOta } = useAppUpdate();
  // "Later" lasts until the app is restarted. An OTA update still applies on
  // the next cold start on its own.
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  if (!otaAvailable || dismissed || !IDLE_PATHS.has(pathname)) return null;

  const update = async () => {
    setInstalling(true);
    try {
      await installOta();
    } catch {
      setInstalling(false);
      setDismissed(true);
    }
  };

  return (
    <ModalWrapper visible onClose={() => setDismissed(true)}>
      <View className="items-center mb-4">
        <View className="w-16 h-16 rounded-full bg-accent/10 items-center justify-center">
          <Ionicons name="cloud-download-outline" size={36} color={colors.accent.DEFAULT} />
        </View>
      </View>
      <Text className="text-text-primary font-bold text-lg text-center">
        Update available
      </Text>
      <Text className="text-text-secondary text-center mt-2">A new version of HomeEase is ready. It takes a few seconds and restarts the app.</Text>
      <View className="flex-row gap-3 mt-6">
        <View className="flex-1">
          <OutlinedButton label="Later" onPress={() => setDismissed(true)} disabled={installing} />
        </View>
        <View className="flex-1">
          <PrimaryButton label="Update now" onPress={update} loading={installing} disabled={installing} />
        </View>
      </View>
    </ModalWrapper>
  );
}
