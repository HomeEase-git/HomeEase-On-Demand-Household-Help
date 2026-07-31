import React from "react";
import { View, Text, ScrollView, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import PrimaryButton from "../../components/ui/PrimaryButton";
import OutlinedButton from "../../components/ui/OutlinedButton";
import { colors } from "../../constants";

export default function PasswordResetSentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; role?: string }>();
  const email = (params.email as string) || "your email";
  const role = (params.role as string) || "client";

  const maskEmail = (email: string) => {
    const [localPart, domain] = email.split("@");
    const masked =
      localPart.charAt(0) +
      "*".repeat(Math.max(0, localPart.length - 2)) +
      localPart.charAt(localPart.length - 1);
    return `${masked}@${domain}`;
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingVertical: 40,
          justifyContent: "center",
        }}
      >
        <View className="items-center mb-8">
          <View className="w-24 h-24 bg-success/20 rounded-full items-center justify-center mb-6">
            <Ionicons name="mail-open" size={56} color={colors.success} />
          </View>
          <Text className="text-text-primary text-3xl font-bold text-center">
            Check Your Email!
          </Text>
        </View>

        <Text className="text-text-secondary text-center text-lg mb-2">
          We&apos;ve sent a password reset link to
        </Text>
        <Text className="text-primary text-center font-semibold text-lg mb-6">
          {maskEmail(email)}
        </Text>

        <View className="bg-blue-50 p-4 rounded-lg mb-6">
          <View className="flex-row items-start gap-3">
            <Ionicons name="information-circle" size={20} color={colors.brand.DEFAULT} />
            <Text className="text-text-secondary text-sm flex-1">
              Follow the link in the email to reset your password. The link will
              expire in 24 hours.
            </Text>
          </View>
        </View>

        <View className="bg-amber-50 p-4 rounded-lg mb-8">
          <View className="flex-row items-start gap-3">
            <Ionicons name="alert-circle" size={20} color={colors.warning} />
            <View className="flex-1">
              <Text className="text-text-secondary font-semibold text-sm mb-1">
                Didn&apos;t receive an email?
              </Text>
              <Text className="text-text-secondary text-xs">
                Check your spam folder or wait a minute before requesting a new
                link.
              </Text>
            </View>
          </View>
        </View>

        <PrimaryButton
          label="Back to Sign In"
          fullWidth
          onPress={() => router.replace("/(auth)/sign-in")}
        />

        <OutlinedButton
          label="Request Another Link"
          // fullWidth
          onPress={() => router.back()}
        />

        <Text className="text-text-muted text-xs text-center mt-6">
          Having trouble?{" "}
          <Text
            className="text-accent underline"
            onPress={() => Linking.openURL("mailto:support@homeease.com")}
          >
            Contact Support
          </Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
