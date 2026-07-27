import React, { useState } from "react";
import { ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { isAxiosError } from "axios";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import * as api from "../../../services/api";

export default function WorkerChangePasswordScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const handleUpdate = async () => {
    if (!current || !newPass || !confirm) {
      Alert.alert("Error", "Fill all fields");
      return;
    }
    if (newPass !== confirm) {
      Alert.alert("Error", "Passwords do not match");
      return;
    }

    setSaving(true);
    try {
      await api.changePassword(current, newPass);
      Alert.alert("Success", "Password updated");
      router.back();
    } catch (error) {
      const message =
        isAxiosError(error) && error.response?.status === 401
          ? "Current password is incorrect"
          : "Unable to update password right now.";
      Alert.alert("Error", message);
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
          onChangeText={setCurrent}
          secureTextEntry
        />
        <InputField
          label="New Password"
          value={newPass}
          onChangeText={setNewPass}
          secureTextEntry
        />
        <InputField
          label="Confirm Password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
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
