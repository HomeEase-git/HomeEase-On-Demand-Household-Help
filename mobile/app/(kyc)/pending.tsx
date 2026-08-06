import React, { useEffect, useRef } from "react";
import { View, Text, BackHandler } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../store/authStore";
import { KycPendingIllustration } from "../../components/illustrations/Illustrations";
import * as api from "../../services/api";

const POLL_INTERVAL_MS = 20000;

// Waiting screen a worker lands on once their KYC docs are submitted but not
// yet decided by an admin. Deliberately has no buttons and no menu/tab bar —
// there is nothing to do here but wait, so it auto-advances itself the
// moment the status changes (via socket push, polled as a fallback) rather
// than offering any way to navigate onward.
export default function KycPendingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const kycStatus = user?.kycStatus;

  useEffect(() => {
    // Swallow the Android hardware back button — there's no screen this
    // waiting state should ever let a worker escape to.
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (kycStatus === "APPROVED") {
      router.replace("/(kyc)/approved");
    } else if (kycStatus === "REJECTED") {
      router.replace("/(kyc)/rejected");
    }
  }, [kycStatus, router]);

  const pollingRef = useRef(false);
  useEffect(() => {
    const interval = setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const profile = await api.getUserProfile();
        if (profile.kycStatus) {
          useAuthStore.getState().setKycStatus(profile.kycStatus);
        }
      } catch (error) {
        console.error("[KYC Pending] Failed to poll verification status:", error);
      } finally {
        pollingRef.current = false;
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

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
    </SafeAreaView>
  );
}
