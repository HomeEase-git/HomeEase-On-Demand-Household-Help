import React from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import OutlinedButton from "../../components/ui/OutlinedButton";
import { useAuthStore } from "../../store/authStore";
import { KycPendingIllustration } from "../../components/illustrations/Illustrations";

export default function KycPendingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const homeRoute =
    user?.role === "worker" ? "/(worker)/home" : "/(client)/home";

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <View className="mb-8">
        <KycPendingIllustration />
      </View>
      <Text className="text-text-primary text-2xl font-bold text-center">
        Verification in Progress
      </Text>
      <Text className="text-text-secondary text-center mt-3">
        Under review. 1-2 business days.
      </Text>
      <View className="bg-card rounded-xl p-4 mt-6">
        <Text className="text-text-secondary text-sm text-center">
          You&apos;ll be notified once approved.
        </Text>
      </View>
      <View className="w-full mt-10">
        <OutlinedButton
          label="Go to Home"
          onPress={() => router.replace(homeRoute)}
        />
      </View>
    </SafeAreaView>
  );
}
