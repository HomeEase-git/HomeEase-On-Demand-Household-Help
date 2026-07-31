import React, { useState, useRef } from "react";
import { View, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function EditProfileScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [email] = useState(user?.email || "");
  const [loading, setLoading] = useState(false);

  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      alertModal.error("Error", "Name cannot be empty");
      return;
    }
    if (phone.length < 10) {
      alertModal.error("Error", "Please enter a valid phone number");
      return;
    }
    setLoading(true);
    try {
      const updatedUser = await api.updateUserProfile({
        fullName: name.trim(),
        phone: phone.trim(),
      });
      setUser(updatedUser);
      alertModal.success("Success", "Profile updated");
      router.back();
    } catch (err) {
      console.error("Update profile error:", err);
      alertModal.error("Error", "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Edit Profile" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <InputField
          ref={nameRef}
          label="Full Name"
          value={name}
          onChangeText={setName}
          placeholder="Name"
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
        />
        <InputField
          ref={phoneRef}
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="09XX-XXX-XXXX"
          keyboardType="phone-pad"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />
        <InputField
          label="Email"
          value={email}
          onChangeText={() => {}}
          editable={false}
          placeholder="Email"
        />
        <PrimaryButton
          label="Save Changes"
          fullWidth
          onPress={handleSave}
          loading={loading}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
