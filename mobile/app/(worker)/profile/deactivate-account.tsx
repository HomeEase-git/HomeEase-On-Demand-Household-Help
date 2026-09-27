import React, { useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "../../../components/ui/KeyboardAwareScrollView";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import { useAuthStore } from "../../../store/authStore";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { colors } from "../../../constants";
import * as api from "../../../services/api";

/**
 * A worker takes a break: they're hidden from search, can't be booked and
 * are signed out everywhere, but nothing is deleted. Signing in again offers
 * to reactivate. The server refuses while a job or request is still open.
 */
export default function DeactivateAccountScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const logout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleDeactivate = () => {
    alertModal.confirm(
      "Deactivate your account?",
      "Clients won't be able to find or book you until you sign in and reactivate.",
      {
        confirmText: "Deactivate",
        destructive: true,
        onConfirm: async () => {
          setSaving(true);
          try {
            await api.deactivateAccount(password, reason.trim() || undefined);
            await logout();
            alertModal.success(
              "Account deactivated",
              "Sign in any time with your email and password to reactivate it.",
              [{ text: "OK", onPress: () => router.replace("/landing") }],
            );
          } catch (error: any) {
            alertModal.error("Couldn't deactivate", error?.message || "Please try again.");
          } finally {
            setSaving(false);
          }
        },
      },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Deactivate Account" showBack />
      <KeyboardAwareScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
        <View className="items-center mb-5">
          <View className="w-20 h-20 bg-accent/10 rounded-full items-center justify-center">
            <Ionicons name="pause-circle-outline" size={40} color={colors.accent.DEFAULT} />
          </View>
        </View>
        <Text className="text-text-primary text-xl font-bold text-center mb-4">Take a break from HomeEase</Text>
        <View className="bg-card rounded-xl p-4 mb-5 gap-2">
          {[
            "You won't appear in search and clients can't book you.",
            "Your profile, documents, reviews and earnings are kept.",
            "You'll be signed out on every device.",
            "Sign in again any time to reactivate.",
          ].map((line) => (
            <View key={line} className="flex-row">
              <Text className="text-text-secondary text-sm mr-2">•</Text>
              <Text className="text-text-secondary text-sm flex-1">{line}</Text>
            </View>
          ))}
        </View>
        <Text className="text-text-muted text-xs mb-4">
          Finish, cancel or decline any open jobs and requests first.
        </Text>
        <InputField
          label="Reason (optional)"
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Going on vacation for a month"
          multiline
        />
        <InputField label="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <View className="gap-3 mt-4">
          <PrimaryButton
            label="Deactivate My Account"
            fullWidth
            loading={saving}
            disabled={!password || saving}
            onPress={handleDeactivate}
          />
          <OutlinedButton label="Cancel" onPress={() => router.back()} />
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
