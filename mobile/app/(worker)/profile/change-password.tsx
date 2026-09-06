import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { isAxiosError } from "axios";
import { AppIcon as Ionicons } from "../../../components/icons/AppIcon";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import * as api from "../../../services/api";
import { colors } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function WorkerChangePasswordScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentError, setCurrentError] = useState("");
  const [newPassError, setNewPassError] = useState("");
  const [confirmError, setConfirmError] = useState("");

  const handleUpdate = async () => {
    setCurrentError("");
    setNewPassError("");
    setConfirmError("");

    if (!current || !newPass || !confirm) {
      setCurrentError(!current ? "Current password is required" : "");
      setNewPassError(!newPass ? "New password is required" : "");
      setConfirmError(!confirm ? "Please confirm your new password" : "");
      return;
    }
    if (newPass !== confirm) {
      setConfirmError("Passwords do not match");
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(current, newPass);
      alertModal.success("Success", "Password updated", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        setCurrentError("Current password is incorrect");
      } else {
        alertModal.error("Error", "Unable to update password right now.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Change Password" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="items-center mb-6">
          <View className="w-16 h-16 bg-accent/10 rounded-full items-center justify-center">
            <Ionicons name="lock-closed-outline" size={30} color={colors.accent.DEFAULT} />
          </View>
        </View>
        <InputField
          label="Current Password"
          value={current}
          onChangeText={(text) => {
            setCurrent(text);
            setCurrentError("");
          }}
          secureTextEntry
          error={currentError}
        />
        <InputField
          label="New Password"
          value={newPass}
          onChangeText={(text) => {
            setNewPass(text);
            setNewPassError("");
          }}
          secureTextEntry
          error={newPassError}
        />
        <InputField
          label="Confirm Password"
          value={confirm}
          onChangeText={(text) => {
            setConfirm(text);
            setConfirmError("");
          }}
          secureTextEntry
          error={confirmError}
        />
        <View className="mt-2">
          <PrimaryButton
            label="Update Password"
            fullWidth
            onPress={handleUpdate}
            loading={saving}
            disabled={saving}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
