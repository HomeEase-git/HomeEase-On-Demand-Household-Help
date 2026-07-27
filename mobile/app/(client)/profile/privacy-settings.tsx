import React, { useState } from "react";
import { View, Text, ScrollView, Switch, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { colors } from "../../../constants";

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const [showProfile, setShowProfile] = useState(true);
  const [location, setLocation] = useState(true);
  const [usage, setUsage] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Privacy Settings" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-card rounded-2xl overflow-hidden">
          <View className="flex-row justify-between items-center py-4 px-4 border-b border-divider">
            <Text className="text-brand">Show Profile</Text>
            <Switch
              value={showProfile}
              onValueChange={setShowProfile}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="flex-row justify-between items-center py-4 px-4 border-b border-divider">
            <Text className="text-brand">Location Access</Text>
            <Switch
              value={location}
              onValueChange={setLocation}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="flex-row justify-between items-center py-4 px-4 border-b border-divider">
            <Text className="text-brand">Share Usage Data</Text>
            <Switch
              value={usage}
              onValueChange={setUsage}
              trackColor={{ false: colors.toggleOff, true: colors.brand.DEFAULT }}
              thumbColor={colors.white}
            />
          </View>
          <View className="py-4 px-4 border-b border-divider">
            <Text className="text-brand">Download My Data</Text>
            <Text className="text-text-muted text-xs mt-1">
              Export your data
            </Text>
          </View>
          <Pressable
            className="py-4 px-4"
            onPress={() => router.push("/(client)/profile/delete-account")}
          >
            <Text className="text-error font-semibold">Delete Account</Text>
          </Pressable>
        </View>
        <View className="mt-6">
          <PrimaryButton
            label="Save Settings"
            fullWidth
            onPress={() => {
              require("react-native").Alert.alert("Saved", "Settings updated");
              router.back();
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
