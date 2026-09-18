import React, { useState, useRef } from "react";
import { View, ScrollView, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import { colors } from "../../../constants";
import { useAlertModal } from "../../../contexts/AlertModalContext";
import { validateName, validatePhone } from "../../../utils/validators";

export default function EditProfileScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [email] = useState(user?.email || "");
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState("");
  const [phoneError, setPhoneError] = useState("");

  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);

  const handleNameChange = (text: string) => {
    setName(text);
    if (nameError) setNameError("");
  };

  const handlePhoneChange = (text: string) => {
    setPhone(text);
    if (phoneError) setPhoneError("");
  };

  const handleSave = async () => {
    const nameValidation = validateName(name);
    const phoneValidation = validatePhone(phone);

    setNameError(nameValidation.error || "");
    setPhoneError(phoneValidation.error || "");

    if (!nameValidation.valid || !phoneValidation.valid) {
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
    } catch (err: any) {
      console.error("Update profile error:", err);
      alertModal.error("Error", err?.message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Edit Profile" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="items-center mb-5">
          <View className="w-16 h-16 rounded-full bg-accent/10 items-center justify-center">
            <Ionicons name="person-outline" size={30} color={colors.accent.DEFAULT} />
          </View>
        </View>
        <InputField
          ref={nameRef}
          label="Full Name"
          value={name}
          onChangeText={handleNameChange}
          placeholder="Name"
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
          error={nameError}
        />
        <InputField
          ref={phoneRef}
          label="Phone"
          value={phone}
          onChangeText={handlePhoneChange}
          placeholder="09XX-XXX-XXXX"
          keyboardType="phone-pad"
          returnKeyType="done"
          onSubmitEditing={handleSave}
          error={phoneError}
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
