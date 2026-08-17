import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Switch, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { privacySettingsStorage } from "../../../utils/storage";

export default function WorkerPrivacySettingsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
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
        alertModal.error("Error", "Location permission was not granted");
      }
    } else {
      alertModal.info(
        "Turn off location access",
        "To turn off location access, disable it for HomeEase in your device Settings.",
      );
      Linking.openSettings().catch(() => {});
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Privacy Settings" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mb-1">
          Visibility
        </Text>
        <View className="bg-card rounded-2xl overflow-hidden" style={cardShadow}>
          <View className="flex-row items-center py-3.5 px-4 border-b border-divider">
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="eye-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary flex-1">Show Profile</Text>
            <Switch
              value={showProfile}
              onValueChange={setShowProfile}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="flex-row items-center py-3.5 px-4 border-b border-divider">
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="location-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary flex-1">Location Access</Text>
            <Switch
              value={locationEnabled}
              onValueChange={handleLocationToggle}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="flex-row items-center py-3.5 px-4">
            <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
              <Ionicons name="bar-chart-outline" size={18} color={colors.accent.DEFAULT} />
            </View>
            <Text className="text-text-primary flex-1">Share Usage Data</Text>
            <Switch
              value={usage}
              onValueChange={setUsage}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
        </View>
        <Text className="text-text-muted text-xs mt-2 px-1">
          Show Profile and Share Usage Data are saved on this device only and won&apos;t carry over if you sign in elsewhere.
        </Text>

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-5 mb-1">
          Your Data
        </Text>
        <Pressable
          className="bg-card rounded-2xl flex-row items-center py-3.5 px-4"
          style={cardShadow}
          onPress={() =>
            Linking.openURL(
              "mailto:support@homeease.com?subject=" +
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
              Email support to request an export of your data
            </Text>
          </View>
        </Pressable>

        <Text className="text-text-muted text-xs font-semibold uppercase tracking-wide mt-5 mb-1">
          Danger Zone
        </Text>
        <Pressable
          className="bg-error/10 rounded-2xl flex-row items-center py-3.5 px-4"
          onPress={() => router.push("/(worker)/profile/delete-account")}
        >
          <View className="w-9 h-9 rounded-full bg-error/10 items-center justify-center mr-3">
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </View>
          <Text className="text-error font-semibold flex-1">Delete Account</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.error} />
        </Pressable>
        <View className="mt-6">
          <PrimaryButton
            label="Save Settings"
            fullWidth
            onPress={async () => {
              await privacySettingsStorage.save({ showProfile, usage });
              alertModal.success("Saved", "Settings saved on this device", [
                { text: "OK", onPress: () => router.back() },
              ]);
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
