import React from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { colors, cardShadow } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

const LINKS = [
  { label: "Rate the App", icon: "star-outline", action: "Opening Play Store..." },
  { label: "Visit Website", icon: "globe-outline", action: "Opening Website..." },
  { label: "Follow us on Facebook", icon: "logo-facebook", action: "Opening Facebook..." },
] as const;

export default function WorkerAboutScreen() {
  const alertModal = useAlertModal();
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="About HomeEase" showBack />
      <ScrollView contentContainerStyle={{ padding: 24, alignItems: "center" }}>
        <View
          className="w-20 h-20 bg-accent rounded-2xl items-center justify-center mb-4"
          style={cardShadow}
        >
          <Ionicons name="home" size={48} color={colors.white} />
        </View>
        <Text className="text-text-primary text-xl font-bold">HomeEase</Text>
        <Text className="text-text-secondary">On-Demand Household Help</Text>
        <Text className="text-text-muted text-sm mt-1">Version 1.0.0</Text>

        <View className="bg-card rounded-2xl p-4 mt-6 w-full" style={cardShadow}>
          <Text className="text-text-secondary text-center leading-5">
            HomeEase connects clients with verified home service workers for
            plumbing, cleaning, electrical, aircon, carpentry, and more across
            Metro Manila and Central Luzon.
          </Text>
        </View>

        <View className="bg-card rounded-2xl mt-6 w-full overflow-hidden" style={cardShadow}>
          {LINKS.map((link, index) => (
            <Pressable
              key={link.label}
              className={`flex-row items-center py-3.5 px-4 ${
                index < LINKS.length - 1 ? "border-b border-divider" : ""
              }`}
              onPress={() => alertModal.info(link.action)}
            >
              <View className="w-9 h-9 rounded-full bg-accent/10 items-center justify-center mr-3">
                <Ionicons name={link.icon} size={18} color={colors.accent.DEFAULT} />
              </View>
              <Text className="text-text-primary flex-1">{link.label}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.text.muted} />
            </Pressable>
          ))}
        </View>

        <Text className="text-text-muted text-xs text-center mt-8">
          Developed by Dela Cruz, Flores, Relleja, Robles — BulSU 2026
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
