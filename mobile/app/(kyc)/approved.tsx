import React from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { useAuthStore } from "../../store/authStore";
import { colors } from "../../constants";

export default function KycApprovedScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const homeRoute =
    user?.role === "worker" ? "/(worker)/home" : "/(client)/home";

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      {/* TODO: Replace with approved/success illustration */}
      <View className="w-32 h-32 bg-success/20 rounded-full items-center justify-center mb-8">
        <Ionicons name="checkmark-circle" size={80} color={colors.success} />
      </View>
      <Text className="text-success text-2xl font-bold text-center">
        Verification Approved!
      </Text>
      <Text className="text-text-secondary text-center mt-3">
        You can now use all HomeEase features.
      </Text>
      <View className="w-full mt-10">
        <PrimaryButton
          label="Start Using HomeEase"
          fullWidth
          onPress={() => router.replace(homeRoute)}
        />
      </View>
    </SafeAreaView>
  );
}
