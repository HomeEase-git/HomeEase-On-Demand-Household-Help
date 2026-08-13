import React, { useEffect, useState, useRef } from "react";
import { View, ScrollView, TextInput, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useAuthStore } from "../../../store/authStore";
import * as api from "../../../services/api";
import { useAlertModal } from "../../../contexts/AlertModalContext";

export default function WorkerEditProfileScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [email] = useState(user?.email ?? "");
  const [bio, setBio] = useState("");
  const [areaRadius, setAreaRadius] = useState("");
  const [trade, setTrade] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  useEffect(() => {
    let active = true;
    async function loadWorkerDetail() {
      if (!user?.id) return;
      try {
        const detail = await api.getWorkerDetail(user.id);
        if (!active || !detail) return;
        setBio(detail.bio ?? "");
        setAreaRadius(detail.serviceAreaRadius ? String(detail.serviceAreaRadius) : "");
      } catch (error) {
        console.error("Load worker detail for edit error:", error);
      }
    }
    async function loadDigitalId() {
      try {
        const digitalId = await api.getMyDigitalId();
        if (!active) return;
        setTrade(digitalId.trade ?? "");
        setServiceArea(digitalId.serviceArea ?? "");
        setLicenseNumber(digitalId.licenseNumber ?? "");
      } catch (error) {
        console.error("Load digital ID for edit error:", error);
      }
    }
    loadWorkerDetail();
    loadDigitalId();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const bioRef = useRef<TextInput>(null);
  const areaRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      alertModal.error("Error", "Name cannot be empty.");
      return;
    }
    if (!phone.trim()) {
      alertModal.error("Error", "Phone number cannot be empty.");
      return;
    }

    try {
      const updatedUser = await api.updateUserProfile({
        fullName: name.trim(),
        phone: phone.trim(),
      });

      await api.updateWorkerProfileDetails({
        bio: bio.trim(),
        serviceAreaRadius: parseInt(areaRadius, 10) || undefined,
        digitalIdTrade: trade.trim(),
        digitalIdServiceArea: serviceArea.trim(),
        licenseNumber: licenseNumber.trim(),
      });

      setUser(updatedUser);

      alertModal.success("Success", "Profile updated successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Update profile error:", error);
      alertModal.error("Error", "Failed to update profile.");
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
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
        />
        <InputField
          ref={phoneRef}
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          returnKeyType="next"
          onSubmitEditing={() => bioRef.current?.focus()}
        />
        <InputField
          label="Email"
          value={email}
          onChangeText={() => {}}
          editable={false}
        />
        <InputField
          ref={bioRef}
          label="Bio"
          value={bio}
          onChangeText={setBio}
          multiline
          returnKeyType="next"
          onSubmitEditing={() => areaRef.current?.focus()}
        />
        <InputField
          ref={areaRef}
          label="Service Area Radius (km)"
          value={areaRadius}
          onChangeText={setAreaRadius}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />

        <View className="bg-card-light rounded-2xl p-4 mb-5">
          <Text className="text-primary font-semibold">Digital ID details</Text>
          <Text className="text-text-secondary text-sm mt-1 mb-3">
            Shown on your Digital ID card alongside your verified photo and
            name.
          </Text>

          <InputField
            label="Trade / Profession"
            value={trade}
            onChangeText={setTrade}
            placeholder="Plumbing"
          />
          <InputField
            label="Service Area"
            value={serviceArea}
            onChangeText={setServiceArea}
            placeholder="Quezon City"
          />
          <InputField
            label="License / Registration Number"
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            placeholder="ABC-2024-001"
          />
        </View>

        <PrimaryButton label="Save Changes" fullWidth onPress={handleSubmit} />
      </ScrollView>
    </SafeAreaView>
  );
}
