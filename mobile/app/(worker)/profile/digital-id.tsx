import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import { useAuthStore } from "../../../store/authStore";
import { useWorkerProfileStore } from "../../../store/workerProfileStore";
import { buildDigitalIdCard } from "../../../utils/digitalId";

export default function DigitalIdScreen() {
  const user = useAuthStore((s) => s.user);
  const digitalId = useWorkerProfileStore((s) => s.digitalId);

  const card = buildDigitalIdCard({
    name: user?.name ?? "",
    email: user?.email ?? "",
    phone: user?.phone ?? "",
    role: "worker",
    trade: digitalId?.trade,
    serviceArea: digitalId?.serviceArea,
    licenseNumber: digitalId?.licenseNumber,
  });

  if (!digitalId?.enabled) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScreenHeader title="Digital ID" showBack />
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <View className="bg-card-light rounded-2xl p-6 items-center">
            <Text className="text-primary font-semibold text-lg mb-2">
              Digital ID is not enabled yet
            </Text>
            <Text className="text-text-secondary text-sm text-center">
              Turn it on from Edit Profile to generate a shareable identity
              card.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Digital ID" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="bg-brand rounded-3xl p-6 shadow-sm">
          <Text className="text-white font-semibold text-sm uppercase tracking-widest">
            {card.verificationLabel}
          </Text>
          <Text className="text-white text-2xl font-bold mt-4">
            {card.fullName}
          </Text>
          <Text className="text-white/80 mt-1">{card.roleLabel}</Text>

          <View className="mt-6 bg-white/15 rounded-2xl p-4">
            <Text className="text-white text-sm">Trade</Text>
            <Text className="text-white font-semibold text-lg">
              {card.trade}
            </Text>
          </View>

          <View className="mt-3 bg-white/15 rounded-2xl p-4">
            <Text className="text-white text-sm">Service Area</Text>
            <Text className="text-white font-semibold text-lg">
              {card.serviceArea}
            </Text>
          </View>

          <View className="mt-3 bg-white/15 rounded-2xl p-4">
            <Text className="text-white text-sm">License / Registration</Text>
            <Text className="text-white font-semibold text-lg">
              {card.licenseNumber}
            </Text>
          </View>
        </View>

        <View className="bg-card-light rounded-2xl p-4 mt-6">
          <Text className="text-primary font-semibold mb-2">How to use it</Text>
          <Text className="text-text-secondary text-sm">
            Show this card to clients before starting work so they can confirm
            your identity and the details you provided.
          </Text>
        </View>

        <View className="bg-card-light rounded-2xl p-4 mt-3">
          <Text className="text-primary font-semibold mb-2">
            Contact details
          </Text>
          <Text className="text-text-secondary text-sm">
            Email: {card.email}
          </Text>
          <Text className="text-text-secondary text-sm mt-1">
            Phone: {card.phone}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
