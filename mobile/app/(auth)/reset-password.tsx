import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../components/ui/ScreenHeader";
import InputField from "../../components/ui/InputField";
import PrimaryButton from "../../components/ui/PrimaryButton";
import OtpInput from "../../components/ui/OtpInput";
import FieldError from "../../components/ui/FieldError";
import { resetPassword, sendPasswordResetEmail } from "../../services/api";
import { colors } from "../../constants";
import { useAlertModal } from "../../contexts/AlertModalContext";

const RESEND_COUNTDOWN_SECONDS = 60;

const requirements = [
  {
    key: "length",
    label: "At least 8 characters",
    test: (s: string) => s.length >= 8,
  },
  {
    key: "upper",
    label: "One uppercase letter",
    test: (s: string) => /[A-Z]/.test(s),
  },
  { key: "number", label: "One number", test: (s: string) => /\d/.test(s) },
];

export default function ResetPasswordScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email as string) || "";

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [newPasswordError, setNewPasswordError] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [countdown, setCountdown] = useState(RESEND_COUNTDOWN_SECONDS);
  const canResend = countdown <= 0;
  const [resending, setResending] = useState(false);

  const strength = requirements.filter((r) => r.test(newPassword)).length;
  const isValidPassword =
    otp.length === 6 && strength === 3 && newPassword === confirmPassword;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleOtpChange = (value: string) => {
    setOtp(value);
    setOtpError("");
  };

  const handleResend = async () => {
    if (!canResend || !email || resending) return;
    setResending(true);
    try {
      await sendPasswordResetEmail(email);
      setCountdown(RESEND_COUNTDOWN_SECONDS);
      setOtp("");
      setOtpError("");
      alertModal.success("Success", "A new code has been sent to your email");
    } catch (err: any) {
      alertModal.error(
        "Error",
        err?.message || "Failed to resend code. Please try again.",
      );
    } finally {
      setResending(false);
    }
  };

  const handleNewPasswordChange = (text: string) => {
    setNewPassword(text);
    setNewPasswordError("");
    if (confirmPassword && text !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match");
    } else {
      setConfirmPasswordError("");
    }
  };

  const handleConfirmPasswordChange = (text: string) => {
    setConfirmPassword(text);
    setConfirmPasswordError(
      text && text !== newPassword ? "Passwords do not match" : "",
    );
  };

  const handleReset = async () => {
    if (otp.length !== 6) {
      setOtpError("Please enter the complete 6-digit code");
      return;
    }
    if (!newPassword || !confirmPassword) {
      setNewPasswordError(!newPassword ? "Password is required" : "");
      setConfirmPasswordError(
        !confirmPassword ? "Please confirm your password" : "",
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match");
      return;
    }
    if (strength < 3) {
      setNewPasswordError("Password does not meet all requirements");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(email, otp, newPassword);
      alertModal.success("Success", "Password reset successfully!", [
        {
          text: "OK",
          onPress: () => router.replace("/(auth)/sign-in"),
        },
      ]);
    } catch (err: any) {
      alertModal.error(
        "Error",
        err?.message || "Failed to reset password. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Reset Password" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-text-primary text-2xl font-bold">Reset Password</Text>
        <Text className="text-text-secondary mt-2 mb-6">
          Enter the 6-digit code we emailed you, then create a strong new
          password.
        </Text>

        <View className="mb-2">
          <OtpInput value={otp} onChangeText={handleOtpChange} length={6} />
        </View>
        <View className="items-center mb-2">
          <FieldError message={otpError} />
        </View>
        <View className="items-center mb-6">
          {canResend ? (
            <Pressable onPress={handleResend} disabled={resending}>
              <Text className="text-accent font-semibold">Resend Code</Text>
            </Pressable>
          ) : (
            <Text className="text-text-muted text-sm">
              Resend code in{" "}
              <Text className="font-semibold text-primary">{countdown}s</Text>
            </Text>
          )}
        </View>

        <InputField
          label="New Password"
          value={newPassword}
          onChangeText={handleNewPasswordChange}
          placeholder="Enter new password"
          secureTextEntry={!showPassword}
          editable={!loading}
          error={newPasswordError}
        />

        <View className="mb-4">
          <View className="flex-row h-1 rounded-full overflow-hidden bg-divider">
            <View
              className={`h-full rounded-full ${
                strength === 0
                  ? "bg-error"
                  : strength === 1
                    ? "bg-error"
                    : strength === 2
                      ? "bg-warning"
                      : "bg-success"
              }`}
              style={{ width: `${(strength / 3) * 100}%` }}
            />
          </View>
          <Text className="text-text-muted text-xs mt-2">
            Password strength:{" "}
            {strength === 0
              ? "Weak"
              : strength === 1
                ? "Fair"
                : strength === 2
                  ? "Good"
                  : "Strong"}
          </Text>
          <View className="flex-row mt-3 gap-2 flex-wrap">
            {requirements.map((r) => (
              <View key={r.key} className="flex-row items-center gap-1">
                <Ionicons
                  name={
                    r.test(newPassword) ? "checkmark-circle" : "ellipse-outline"
                  }
                  size={16}
                  color={r.test(newPassword) ? colors.success : colors.text.muted}
                />
                <Text
                  className={`text-xs ${
                    r.test(newPassword) ? "text-success" : "text-text-muted"
                  }`}
                >
                  {r.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="relative">
          <InputField
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={handleConfirmPasswordChange}
            placeholder="Confirm new password"
            secureTextEntry={!showConfirmPassword}
            editable={!loading}
            error={confirmPasswordError}
          />
          <Pressable
            className="absolute right-3 top-10"
            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
          >
            <Ionicons
              name={showConfirmPassword ? "eye-off" : "eye"}
              size={20}
              color={colors.text.secondary}
            />
          </Pressable>
        </View>

        <PrimaryButton
          label="Reset Password"
          fullWidth
          onPress={handleReset}
          loading={loading}
          disabled={!isValidPassword || loading}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
