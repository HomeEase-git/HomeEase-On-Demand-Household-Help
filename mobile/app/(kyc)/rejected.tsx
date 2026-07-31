import React from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import PrimaryButton from "../../components/ui/PrimaryButton";
import OutlinedButton from "../../components/ui/OutlinedButton";
import { useAuthStore } from "../../store/authStore";
import { colors } from "../../constants";

export default function KycRejectedScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const supportPath =
    user?.role === "worker"
      ? "/(worker)/profile/help-support"
      : "/(client)/profile/contact-us";

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      {/* TODO: Replace with rejection illustration */}
      <View className="w-32 h-32 bg-error/20 rounded-full items-center justify-center mb-8">
        <Ionicons name="close-circle" size={80} color={colors.error} />
      </View>
      <Text className="text-error text-2xl font-bold text-center">
        Verification Failed
      </Text>
      <View className="bg-error/10 border border-error rounded-xl p-4 mt-6 w-full">
        <Text className="text-error text-sm">
          Your ID photo was unclear. Please re-upload.
        </Text>
      </View>
      <View className="w-full mt-8 gap-3">
        <PrimaryButton
          label="Re-submit Documents"
          fullWidth
          onPress={() => router.replace("/(kyc)/upload-id")}
        />
        <OutlinedButton
          label="Contact Support"
          onPress={() => router.push(supportPath)}
        />
      </View>
    </SafeAreaView>
  );
}
