import React, { useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import { useRouter } from "expo-router";
import { isAxiosError } from "axios";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import DangerButton from "../../../components/ui/DangerButton";
import OutlinedButton from "../../../components/ui/OutlinedButton";
import { useAuthStore } from "../../../store/authStore";
import { colors } from "../../../constants";
import * as api from "../../../services/api";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function WorkerDeleteAccountScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const logout = useAuthStore((s) => s.logout);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canDelete = confirmText === "DELETE" && password.length > 0;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteAccount(password);
      logout();
      alertModal.success(
        "Account deleted",
        "Your account has been permanently deleted",
        [{ text: "OK", onPress: () => router.replace("/landing") }],
      );
    } catch (error) {
      const message =
        isAxiosError(error) && error.response?.status === 401
          ? "Password is incorrect"
          : "Failed to delete account";
      alertModal.error("Error", message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Delete Account" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="items-center mb-6">
          <View className="w-24 h-24 bg-error/20 rounded-full items-center justify-center">
            <Ionicons name="warning" size={60} color={colors.error} />
          </View>
        </View>
        <Text className="text-error text-2xl font-bold text-center mb-4">
          Delete Your Account?
        </Text>
        <View className="bg-error/10 border border-error rounded-xl p-4 mb-4">
          <Text className="text-error text-sm">
            This will permanently remove your account, bookings, and data. This
            action cannot be undone.
          </Text>
        </View>
        <Text className="text-text-secondary text-sm mb-2">
          Type DELETE to confirm
        </Text>
        <InputField
          value={confirmText}
          onChangeText={setConfirmText}
          placeholder="DELETE"
          label="Confirmation"
        />
        <InputField
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          label="Password"
          secureTextEntry
        />
        <View className="gap-3 mt-6">
          <DangerButton
            label={deleting ? "Deleting..." : "Delete My Account"}
            fullWidth
            disabled={!canDelete || deleting}
            onPress={handleDelete}
          />
          <OutlinedButton label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
