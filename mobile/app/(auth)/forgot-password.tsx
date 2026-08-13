import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import InputField from "../../components/ui/InputField";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { isValidEmail } from "../../utils/validators";
import { sendPasswordResetEmail } from "../../services/api";
import { useAlertModal } from "../../contexts/AlertModalContext";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const params = useLocalSearchParams<{ role?: string }>();
  const role = (params.role as string) || "client";

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState("");

  const handleEmailChange = (text: string) => {
    setEmail(text);
    setEmailError("");
  };

  const handleSend = async () => {
    if (!email.trim()) {
      setEmailError("Email is required");
      return;
    }

    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(email);
      router.push({
        pathname: "/(auth)/password-reset-sent",
        params: { email, role },
      });
    } catch (err: any) {
      alertModal.error(
        "Error",
        err?.message || "Failed to send reset email. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Forgot Password" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-text-primary text-2xl font-bold">
          Forgot Password?
        </Text>
        <Text className="text-text-secondary mt-2 mb-6">
          {"Enter your email and we'll send you a 6-digit reset code."}
        </Text>

        <InputField
          label="Email"
          value={email}
          onChangeText={handleEmailChange}
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={handleSend}
          editable={!loading}
          error={emailError}
        />

        <PrimaryButton
          label="Send Reset Code"
          fullWidth
          onPress={handleSend}
          loading={loading}
        />

        <Text className="text-text-secondary text-xs text-center mt-6">
          {"We'll send you an email with a 6-digit code to reset your password. Make sure to check your spam folder if you don't see it."}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
