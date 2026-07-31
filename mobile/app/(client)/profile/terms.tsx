import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";

const SECTIONS = [
  {
    title: "1. Acceptance",
    content:
      "By using HomeEase you agree to these terms. Please read them carefully.",
  },
  {
    title: "2. Services",
    content:
      "HomeEase is a platform connecting clients with home service workers. We do not employ workers directly. Bookings are agreements between you and the worker.",
  },
  {
    title: "3. Booking & Payment",
    content:
      "Payment is processed as per the chosen method. Cancellation policies apply as stated at booking.",
  },
];

export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Terms and Conditions" showBack />
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
