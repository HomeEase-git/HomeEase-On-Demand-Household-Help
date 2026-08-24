import React from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { colors } from "../../constants";
import { KycVerifyIllustration } from "../../components/illustrations/Illustrations";

export default function KycLandingScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Identity Verification" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
      >
        <View className="items-center my-6">
          <KycVerifyIllustration size={160} />
        </View>
        <Text className="text-text-primary text-xl font-bold text-center">
          Verify Your Identity
        </Text>
        <View className="bg-card rounded-xl p-4 mt-4">
          <Text className="text-text-secondary text-sm">
            We need to verify your identity to keep HomeEase safe.
          </Text>
        </View>
        <View className="mt-6">
          {[
            "Valid government-issued ID",
            "A clear selfie photo",
            "Certifications (workers only)",
          ].map((item, i) => (
            <View key={i} className="flex-row items-center mb-3">
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={colors.success}
              />
              <Text className="text-text-secondary ml-2">{item}</Text>
            </View>
          ))}
        </View>
        <View className="mt-8">
          <PrimaryButton
            label="Start Verification"
            fullWidth
            onPress={() => router.push("/(kyc)/upload-id")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
