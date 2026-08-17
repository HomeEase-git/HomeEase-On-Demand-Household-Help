import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { colors, cardShadow } from "../../../constants";

export default function AboutScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="About HomeEase" showBack />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View
          className="bg-card rounded-2xl p-6 mx-4 mt-4 items-center"
          style={cardShadow}
        >
          <View className="w-20 h-20 bg-accent rounded-2xl items-center justify-center mb-4">
            <Ionicons name="home" size={48} color={colors.white} />
          </View>
          <Text className="text-text-primary text-xl font-bold">HomeEase</Text>
          <Text className="text-text-secondary">On-Demand Household Help</Text>
          <Text className="text-text-muted text-sm mt-1">Version 1.0.0</Text>
        </View>

        <View className="bg-card rounded-2xl p-5 mx-4 mt-3" style={cardShadow}>
          <Text className="text-text-secondary text-center leading-5">
            HomeEase connects you with verified home service workers for plumbing,
            cleaning, electrical, and more.
          </Text>
        </View>

        <Text className="text-text-muted text-xs text-center mt-6 px-8">
          Developed by Dela Cruz, Flores, Relleja, Robles — BulSU 2026
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
