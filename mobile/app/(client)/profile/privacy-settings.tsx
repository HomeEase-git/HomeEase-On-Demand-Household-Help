import React, { useEffect, useState } from "react";
import { COMPANY } from "../../../constants/legalDocuments";
import { View, Text, ScrollView, Switch, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors, cardShadow } from "../../../constants";
import { useToastContext } from "../../../contexts/ToastContext";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { useAuthStore } from "../../../store/authStore";
import { logoutAllSessions } from "../../../services/api";
import { privacySettingsStorage } from "../../../utils/storage";

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const toast = useToastContext();
  const alertModal = useAlertModal();
  const logout = useAuthStore((s) => s.logout);
  const [showProfile, setShowProfile] = useState(true);
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [usage, setUsage] = useState(false);

  useEffect(() => {
    privacySettingsStorage.get().then((saved) => {
      setShowProfile(saved.showProfile);
      setUsage(saved.usage);
    });
  }, []);

  const checkLocationPermission = async () => {
    const { status } = await Location.getForegroundPermissionsAsync();
    setLocationEnabled(status === "granted");
  };

  useFocusEffect(
    React.useCallback(() => {
      checkLocationPermission();
    }, []),
  );

  const handleLocationToggle = async (next: boolean) => {
    if (next) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationEnabled(status === "granted");
      if (status !== "granted") {
        toast.error("Location permission was not granted");
      }
    } else {
      toast.info(
        "To turn off location access, disable it for HomeEase in your device Settings.",
      );
      Linking.openSettings().catch(() => {});
    }
  };

  const handleLogoutAllDevices = () => {
    alertModal.confirm(
      "Log out of all devices?",
      "This will sign you out everywhere, including this device. You'll need to sign in again.",
      {
        confirmText: "Log Out All",
        destructive: true,
        onConfirm: async () => {
          try {
            await logoutAllSessions();
          } catch (error) {
            console.error("Logout all devices error:", error);
            alertModal.error(
              "Error",
              "Unable to log out of all devices right now. Please try again.",
            );
            return;
          }
          await logout();
          router.replace("/landing");
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
          <View className="flex-row justify-between items-center py-3.5 px-4 border-b border-divider">
            <View className="flex-row items-center flex-1 mr-3">
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name="eye-outline" size={18} color={colors.accent.DEFAULT} />
              </View>
              <Text className="text-text-primary flex-1">Show Profile</Text>
            </View>
            <Switch
              value={showProfile}
              onValueChange={setShowProfile}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="flex-row justify-between items-center py-3.5 px-4 border-b border-divider">
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
          <View className="flex-row justify-between items-center py-3.5 px-4">
            <View className="flex-row items-center flex-1 mr-3">
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name="bar-chart-outline" size={18} color={colors.accent.DEFAULT} />
              </View>
              <Text className="text-text-primary flex-1">Share Usage Data</Text>
            </View>
            <Switch
              value={usage}
              onValueChange={setUsage}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
        </View>
        <Text className="text-text-muted text-xs mt-2 px-1">
          Show Profile and Share Usage Data apply to this device only.
        </Text>

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
          <Pressable
            className="flex-row items-center py-4 px-4"
            onPress={handleLogoutAllDevices}
          >
            <View className="w-9 h-9 rounded-full bg-error/10 items-center justify-center mr-3">
              <Ionicons name="phone-portrait-outline" size={18} color={colors.error} />
            </View>
            <Text className="text-error flex-1 font-semibold">Log Out of All Devices</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </Pressable>
          <Pressable
            className="flex-row items-center py-4 px-4 border-t border-divider"
            onPress={() => router.push("/(client)/profile/delete-account")}
          >
            <View className="w-9 h-9 rounded-full bg-error/10 items-center justify-center mr-3">
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </View>
            <Text className="text-error flex-1 font-semibold">Delete Account</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.error} />
          </Pressable>
        </View>
        <View className="mt-6">
          <PrimaryButton
            label="Save Settings"
            fullWidth
            onPress={async () => {
              await privacySettingsStorage.save({ showProfile, usage });
              router.back();
              // Deferred so the toast's view mount doesn't land in the same Fabric
              // commit as the screen swap above (that race crashes with "specified
              // child already has a parent" on the New Architecture).
              setTimeout(() => toast.success("Settings saved on this device"), 0);
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
