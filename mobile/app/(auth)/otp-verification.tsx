import React, { useState, useEffect } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import OtpInput from "../../components/ui/OtpInput";
import FieldError from "../../components/ui/FieldError";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { useAuthStore } from "../../store/authStore";
import { verifyOtp, sendOtpEmail } from "../../services/api";
import { colors } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";

const COUNTDOWN_SECONDS = 60;

export default function OtpVerificationScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email as string) || "";

  const { setLoading, loading } = useAuthStore((s) => ({
    setLoading: s.setLoading,
    loading: s.loading,
  }));

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [canResend, setCanResend] = useState(false);

  const handleOtpChange = (value: string) => {
    setOtp(value);
    setOtpError("");
  };

  useEffect(() => {
    if (countdown <= 0) {
      setCanResend(true);
      return;
    }
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      setOtpError("Please enter a complete 6-digit OTP");
      return;
    }

    setLoading(true);
    try {
      const response = await verifyOtp(email || "user@example.com", otp);

      if (response.success) {
        // Store token if needed
        router.push("/(auth)/account-created-success");
      }
    } catch (err: any) {
      setOtpError(err?.message || "OTP verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!canResend || !email) return;

    setLoading(true);
    try {
      await sendOtpEmail(email);
      setCountdown(COUNTDOWN_SECONDS);
      setCanResend(false);
      setOtp("");
      setOtpError("");
      alertModal.success("Success", "OTP sent to your email");
    } catch (err: any) {
      alertModal.error(
        "Error",
        err?.message || "Failed to resend OTP. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const maskEmail = (email: string) => {
    const [localPart, domain] = email.split("@");
    const masked =
      localPart.charAt(0) +
      "*".repeat(localPart.length - 2) +
      localPart.charAt(localPart.length - 1);
    return `${masked}@${domain}`;
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-16 h-16 bg-blue-100 rounded-full items-center justify-center mb-6">
          <Ionicons name="mail" size={32} color={colors.brand.DEFAULT} />
        </View>

        <Text className="text-text-primary text-2xl font-bold">
          Verify Your Email
        </Text>
        <Text className="text-text-secondary mt-2 mb-2">
          We sent a 6-digit code to
        </Text>
        <Text className="text-primary font-semibold mb-6">
          {maskEmail(email)}
        </Text>

        <OtpInput
          value={otp}
          onChangeText={handleOtpChange}
          length={6}
          // autoFocus={true}
        />
        <View className="items-center">
          <FieldError message={otpError} />
        </View>

        <View className="mt-8">
          <PrimaryButton
            label="Verify"
            fullWidth
            onPress={handleVerify}
            loading={loading}
          />
        </View>

        <View className="mt-8 items-center">
          {canResend ? (
            <Pressable onPress={handleResend} disabled={loading}>
              <Text className="text-accent font-semibold">Resend Code</Text>
            </Pressable>
          ) : (
            <Text className="text-text-muted text-sm">
              Resend code in{" "}
              <Text className="font-semibold text-primary">{countdown}s</Text>
            </Text>
          )}
        </View>

        <View className="mt-8 p-4 bg-blue-50 rounded-lg">
          <View className="flex-row items-start">
            <Ionicons name="information-circle" size={20} color={colors.brand.DEFAULT} />
            <Text className="text-xs text-text-secondary ml-2 flex-1">
              Didn&apos;t receive the code? Check your spam folder or wait a
              moment before requesting a new code.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
