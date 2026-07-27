import React, { useEffect, useState, useRef } from "react";
import { View, ScrollView, Alert, TextInput, Text, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../components/ui/ScreenHeader";
import InputField from "../../../components/ui/InputField";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { useAuthStore } from "../../../store/authStore";
import { useWorkerProfileStore } from "../../../store/workerProfileStore";
import * as api from "../../../services/api";

export default function WorkerEditProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const savedDigitalId = useWorkerProfileStore((s) => s.digitalId);
  const setDigitalId = useWorkerProfileStore((s) => s.setDigitalId);

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [email] = useState(user?.email ?? "");
  const [bio, setBio] = useState("");
  const [years, setYears] = useState("");
  const [areaRadius, setAreaRadius] = useState("");

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
    loadWorkerDetail();
    return () => {
      active = false;
    };
  }, [user?.id]);
  const [digitalIdEnabled, setDigitalIdEnabled] = useState(
    savedDigitalId?.enabled ?? false,
  );
  const [trade, setTrade] = useState(savedDigitalId?.trade ?? "");
  const [serviceArea, setServiceArea] = useState(
    savedDigitalId?.serviceArea ?? "",
  );
  const [licenseNumber, setLicenseNumber] = useState(
    savedDigitalId?.licenseNumber ?? "",
  );

  const nameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const bioRef = useRef<TextInput>(null);
  const yearsRef = useRef<TextInput>(null);
  const areaRef = useRef<TextInput>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert("Error", "Name cannot be empty.");
      return;
    }
    if (!phone.trim()) {
      Alert.alert("Error", "Phone number cannot be empty.");
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
      });

      setUser(updatedUser);

      setDigitalId({
        enabled: digitalIdEnabled,
        trade: trade.trim(),
        serviceArea: serviceArea.trim(),
        licenseNumber: licenseNumber.trim(),
      });

      Alert.alert("Success", "Profile updated successfully.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Update profile error:", error);
      Alert.alert("Error", "Failed to update profile.");
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
          onSubmitEditing={() => yearsRef.current?.focus()}
        />
        <InputField
          ref={yearsRef}
          label="Years of Experience"
          value={years}
          onChangeText={setYears}
          keyboardType="number-pad"
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
          <View className="flex-row items-start justify-between mb-3">
            <View className="flex-1 mr-3">
              <Text className="text-brand font-semibold">Digital ID</Text>
              <Text className="text-text-secondary text-sm mt-1">
                Enable a shareable identity card for clients.
              </Text>
            </View>
            <Switch
              value={digitalIdEnabled}
              onValueChange={setDigitalIdEnabled}
            />
          </View>

          {digitalIdEnabled ? (
            <View>
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
          ) : null}
        </View>

        <PrimaryButton label="Save Changes" fullWidth onPress={handleSubmit} />
      </ScrollView>
    </SafeAreaView>
  );
}
