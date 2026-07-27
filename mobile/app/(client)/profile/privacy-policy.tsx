import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Privacy Policy" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-primary font-bold text-lg mb-2">
          Data We Collect
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          We collect information you provide when registering, booking, and
          communicating with workers. This includes name, email, phone, and
          address.
        </Text>
        <Text className="text-text-primary font-bold text-lg mb-2">
          How We Use It
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Your data is used to facilitate bookings, verify identity, process
          payments, and improve our services.
        </Text>
        <Text className="text-text-primary font-bold text-lg mb-2">Security</Text>
        <Text className="text-text-secondary text-sm mb-4">
          We use industry-standard measures to protect your personal
          information.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
