import React, { useState } from "react";
import { COMPANY } from "../../../constants/legalDocuments";
import { View, Text, ScrollView, Switch, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { colors, cardShadow } from "../../../constants";
import { useToastContext } from "../../../contexts/ToastContext";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { useAuthStore } from "../../../store/authStore";
import { logoutAllSessions, getActiveSessionCount } from "../../../services/api";

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const toast = useToastContext();
  const alertModal = useAlertModal();
  const logout = useAuthStore((s) => s.logout);
  const [locationEnabled, setLocationEnabled] = useState(false);

  const checkLocationPermission = async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationEnabled(status === "granted");
  };

  // "Log out of other devices" only makes sense with more than one.
  const [sessionCount, setSessionCount] = useState(1);

  useFocusEffect(
    React.useCallback(() => {
      checkLocationPermission();
      getActiveSessionCount()
        .then(setSessionCount)
        .catch(() => setSessionCount(1));
    }, []),
  );

  const handleLocationToggle = async (next: boolean) => {
    if (next) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationEnabled(status === "granted");
      if (status !== "granted") {
        // Once denied, Android won't prompt again; only Settings can turn it on.
        alertModal.error("Location is off", "Turn on location for HomeEase in your phone settings.", [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => {}) },
        ]);
      }
    } else {
      toast.info(
        "To turn off location access, disable it for HomeEase in your device Settings.",
      );
      Linking.openSettings().catch(() => {});
    }
  };

  const handleLogoutAllDevices = () => {
    const others = sessionCount - 1;
    alertModal.confirm(
      "Log out of your other devices?",
      `This signs you out on ${others} other device${others === 1 ? "" : "s"}. This device stays signed in.`,
      {
        confirmText: "Log Out Others",
        destructive: true,
        onConfirm: async () => {
          try {
            const result = await logoutAllSessions();
            if (result.signedOutCurrent) {
              await logout();
              router.replace("/landing");
              return;
            }
            setSessionCount(1);
            alertModal.success("Done", result.message);
          } catch (error) {
            console.error("Logout other devices error:", error);
            alertModal.error("Error", "Unable to log out your other devices right now. Please try again.");
          }
        },
      },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Privacy Settings" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
          Privacy
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          <View className="flex-row justify-between items-center py-3.5 px-4">
            <View className="flex-row items-center flex-1 mr-3">
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name="location-outline" size={18} color={colors.accent.DEFAULT} />
              </View>
              <Text className="text-text-primary flex-1">Location Access</Text>
            </View>
            <Switch
              value={locationEnabled}
              onValueChange={handleLocationToggle}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
        </View>

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-5 mb-1">
          Data & Account
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          <Pressable
            className="flex-row items-center py-3.5 px-4"
            onPress={() =>
              Linking.openURL(
                `mailto:${COMPANY.privacyEmail}?subject=` +
                  encodeURIComponent("Data export request"),
              ).catch(() => {})
            }
          >
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="download-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <View className="flex-1">
              <Text className="text-text-primary">Download My Data</Text>
              <Text className="text-text-muted text-xs mt-0.5">
                Request a copy of your data by email
              </Text>
            </View>
          </Pressable>
        </View>

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-5 mb-1">
          Danger Zone
        </Text>
        <View className="bg-error/10 rounded-2xl overflow-hidden">
          {sessionCount > 1 && (
            <Pressable
              className="flex-row items-center py-4 px-4"
              onPress={handleLogoutAllDevices}
            >
              <View className="w-9 h-9 rounded-full bg-error/10 items-center justify-center mr-3">
                <Ionicons name="phone-portrait-outline" size={18} color={colors.error} />
              </View>
              <Text className="text-error flex-1 font-semibold">Log Out of Other Devices</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.error} />
            </Pressable>
          )}
          <Pressable
            className={`flex-row items-center py-4 px-4 ${sessionCount > 1 ? "border-t border-divider" : ""}`}
            onPress={() => router.push("/(client)/profile/delete-account")}
          >
            <View className="w-9 h-9 rounded-full bg-error/10 items-center justify-center mr-3">
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </View>
            <Text className="text-error flex-1 font-semibold">Delete Account</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
