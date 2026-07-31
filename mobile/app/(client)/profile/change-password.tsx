import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { isAxiosError } from "axios";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import * as api from "../../../services/api";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function ChangePasswordScreen() {
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
        <PrimaryButton
          label="Update Password"
          fullWidth
          onPress={handleUpdate}
          loading={saving}
          disabled={saving}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
