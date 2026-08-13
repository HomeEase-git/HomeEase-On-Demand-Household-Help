import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Switch, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors } from "../../../constants";
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
        <View className="bg-card rounded-2xl overflow-hidden">
          <View className="flex-row justify-between items-center py-4 px-4 border-b border-divider">
            <Text className="text-primary">Show Profile</Text>
            <Switch
              value={showProfile}
              onValueChange={setShowProfile}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="flex-row justify-between items-center py-4 px-4 border-b border-divider">
            <Text className="text-primary">Location Access</Text>
            <Switch
              value={locationEnabled}
              onValueChange={handleLocationToggle}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="flex-row justify-between items-center py-4 px-4 border-b border-divider">
            <Text className="text-primary">Share Usage Data</Text>
            <Switch
              value={usage}
              onValueChange={setUsage}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <Pressable
            className="py-4 px-4 border-b border-divider"
            onPress={() =>
              Linking.openURL(
                "mailto:support@homeease.com?subject=" +
                  encodeURIComponent("Data export request"),
              ).catch(() => {})
            }
          >
            <Text className="text-primary">Download My Data</Text>
            <Text className="text-text-muted text-xs mt-1">
              Email support to request an export of your data
            </Text>
          </Pressable>
          <Pressable
            className="py-4 px-4"
            onPress={() => router.push("/(worker)/profile/delete-account")}
          >
            <Text className="text-error font-semibold">Delete Account</Text>
          </Pressable>
        </View>
        <Text className="text-text-muted text-xs mt-3 px-1">
          Show Profile and Share Usage Data are saved on this device only and won&apos;t carry over if you sign in elsewhere.
        </Text>
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
