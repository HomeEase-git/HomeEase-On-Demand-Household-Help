import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import PrimaryButton from "../../components/ui/PrimaryButton";
import OutlinedButton from "../../components/ui/OutlinedButton";
import { useAuthStore } from "../../store/authStore";
import { getUserProfile } from "../../services/api";
import { KycRejectedIllustration } from "../../components/illustrations/Illustrations";

const FALLBACK_REASON =
  "Our team found an issue with your submitted documents. Please contact support for details, or re-submit your documents.";

export default function KycRejectedScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const supportPath =
    user?.role === "worker"
      ? "/(worker)/profile/help-support"
      : "/(client)/profile/contact-us";

  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getUserProfile();
        if (!cancelled) setReason(profile.kycRejectionReason ?? null);
      } catch (error) {
        console.error("Failed to load rejection reason:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-white items-center justify-center px-8">
      <View className="mb-8">
        <KycRejectedIllustration size={160} />
      </View>
      <Text className="text-error text-2xl font-bold text-center">
        Verification Failed
      </Text>
      <View className="bg-error/10 border border-error rounded-xl p-4 mt-6 w-full">
        <Text className="text-error text-sm">{reason || FALLBACK_REASON}</Text>
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
