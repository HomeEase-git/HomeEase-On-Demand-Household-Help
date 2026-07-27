import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import PrimaryButton from "../../components/ui/PrimaryButton";
import OutlinedButton from "../../components/ui/OutlinedButton";
import { verifyEmail } from "../../services/api";
import { colors } from "../../constants";

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; token?: string }>();
  const email = (params.email as string) || "";
  const token = (params.token as string) || "";

  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    // Auto-verify if token is provided via deep link
    if (token) {
      handleVerifyEmail();
    }
  }, [token]);

  const handleVerifyEmail = async () => {
    if (!token && !verified) {
      Alert.alert("Error", "Invalid verification link");
      return;
    }

    setLoading(true);
    try {
      const response = await verifyEmail(email, token);
      if (response.success) {
        setVerified(true);
      }
    } catch (err: any) {
      Alert.alert(
        "Error",
        err?.message || "Email verification failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const maskEmail = (email: string) => {
    const [localPart, domain] = email.split("@");
    const masked =
      localPart.charAt(0) +
      "*".repeat(Math.max(0, localPart.length - 2)) +
      localPart.charAt(localPart.length - 1);
    return `${masked}@${domain}`;
  };

  if (verified) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingVertical: 40,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View className="w-24 h-24 bg-success/20 rounded-full items-center justify-center mb-8">
            <Ionicons name="checkmark-circle" size={56} color={colors.success} />
          </View>

          <Text className="text-text-primary text-2xl font-bold text-center mb-2">
            Email Verified!
          </Text>

          <Text className="text-text-secondary text-center mb-8">
            Your email address has been successfully verified. You can now
            proceed with your account.
          </Text>

          <PrimaryButton
            label="Continue"
            fullWidth
            onPress={() => router.replace("/(auth)/sign-in")}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingVertical: 40,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View className="w-24 h-24 bg-blue-100 rounded-full items-center justify-center mb-8">
          <Ionicons name="mail" size={56} color={colors.brand.DEFAULT} />
        </View>

        <Text className="text-text-primary text-2xl font-bold text-center mb-2">
          Verify Your Email
        </Text>

        <Text className="text-text-secondary text-center mb-6">
          We&apos;ve sent a verification link to {maskEmail(email)}
        </Text>

        <View className="w-full bg-blue-50 p-4 rounded-lg mb-8">
          <View className="flex-row items-start gap-3">
            <Ionicons name="information-circle" size={20} color={colors.brand.DEFAULT} />
            <Text className="text-text-secondary text-sm flex-1">
              Click the link in your email to verify your account. The link will
              expire in 24 hours.
            </Text>
          </View>
        </View>

        <Text className="text-text-secondary text-center text-sm mb-8">
          Click the button below if the link in your email doesn&apos;t work.
        </Text>

        <PrimaryButton
          label="Verify Email"
          fullWidth
          onPress={handleVerifyEmail}
          loading={loading}
          disabled={!token}
        />

        <OutlinedButton
          label="Back to Sign In"
          //   fullWidth
          onPress={() => router.replace("/(auth)/sign-in")}
        />

        <Text className="text-text-muted text-xs text-center mt-6">
          Didn&apos;t receive the email? Check your spam folder.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
