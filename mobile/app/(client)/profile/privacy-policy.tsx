import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";

const SECTIONS = [
  {
    title: "Data We Collect",
    content:
      "We collect information you provide when registering, booking, and communicating with workers. This includes name, email, phone, and address.",
  },
  {
    title: "How We Use It",
    content:
      "Your data is used to facilitate bookings, verify identity, process payments, and improve our services.",
  },
  {
    title: "Security",
    content:
      "We use industry-standard measures to protect your personal information.",
  },
];

export default function PrivacyPolicyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Privacy Policy" showBack />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {SECTIONS.map((section) => (
          <View key={section.title} className="bg-card rounded-2xl p-4 mb-3">
            <Text className="text-text-primary font-bold text-base mb-2">
              {section.title}
            </Text>
            <Text className="text-text-secondary text-sm leading-5">
              {section.content}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
