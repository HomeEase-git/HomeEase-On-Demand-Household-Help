import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { colors } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function WorkerAboutScreen() {
  const alertModal = useAlertModal();
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="About HomeEase" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, alignItems: "center" }}>
        <View className="w-20 h-20 bg-accent rounded-2xl items-center justify-center mb-4">
          <Ionicons name="home" size={48} color={colors.white} />
        </View>
        <Text className="text-text-primary text-xl font-bold">HomeEase</Text>
        <Text className="text-text-secondary">On-Demand Household Help</Text>
        <Text className="text-text-muted text-sm mt-1">Version 1.0.0</Text>

        <Text className="text-text-secondary text-center mt-6">
          HomeEase connects clients with verified home service workers for
          plumbing, cleaning, electrical, aircon, carpentry, and more across
          Metro Manila and Central Luzon.
        </Text>

        <View className="mt-8 w-full gap-3">
          <Text
            className="text-accent text-center"
            onPress={() => alertModal.info("Opening Play Store...")}
          >
            Rate the App
          </Text>
          <Text
            className="text-accent text-center"
            onPress={() => alertModal.info("Opening Website...")}
          >
            Visit Website
          </Text>
          <Text
            className="text-accent text-center"
            onPress={() => alertModal.info("Opening Facebook...")}
          >
            Follow us on Facebook
          </Text>
        </View>

        <Text className="text-text-muted text-xs text-center mt-8">
          Developed by Dela Cruz, Flores, Relleja, Robles — BulSU 2026
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
