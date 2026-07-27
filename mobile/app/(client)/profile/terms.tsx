import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";

export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Terms and Conditions" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-text-primary font-bold text-lg mb-2">
          1. Acceptance
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          By using HomeEase you agree to these terms. Please read them
          carefully.
        </Text>
        <Text className="text-text-primary font-bold text-lg mb-2">2. Services</Text>
        <Text className="text-text-secondary text-sm mb-4">
          HomeEase is a platform connecting clients with home service workers.
          We do not employ workers directly. Bookings are agreements between you
          and the worker.
        </Text>
        <Text className="text-text-primary font-bold text-lg mb-2">
          3. Booking & Payment
        </Text>
        <Text className="text-text-secondary text-sm mb-4">
          Payment is processed as per the chosen method. Cancellation policies
          apply as stated at booking.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
