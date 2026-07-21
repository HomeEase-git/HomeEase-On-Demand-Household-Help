import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Alert, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors } from "../../../../constants";
import { addressStorage } from "../../../../utils/storage";
import * as api from "../../../../services/api";

const LABEL_OPTIONS = ["Home", "Work", "Other"];

export default function AddressEditScreen() {
  const router = useRouter();
  const { addressId } = useLocalSearchParams<{ addressId: string }>();
  const isNew = addressId === "new";

  const [label, setLabel] = useState("Home");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadExisting = async () => {
      if (!addressId || isNew) return;
      const existing = await addressStorage.get(addressId);
      if (existing) {
        setLabel(existing.label ?? "Home");
        setStreet(existing.street ?? "");
        setCity(existing.city ?? "");
        setState(existing.state ?? "");
        setZipCode(existing.zipCode ?? "");
      }
    };

    loadExisting();
  }, [addressId, isNew]);

  const handleSave = async () => {
    if (!street.trim() || !city.trim() || !state.trim() || !zipCode.trim()) {
      Alert.alert("Error", "Please fill in all address fields.");
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const result = await api.addAddress({
          label,
          street,
          city,
          state,
          zipCode,
        });
        await addressStorage.create({
          label,
          address: `${street}, ${city}, ${state} ${zipCode}`,
        });
      } else if (addressId) {
        const result = await api.updateAddress(addressId, {
          label,
          street,
          city,
          state,
          zipCode,
        });
        await addressStorage.update(addressId, {
          label,
          address: `${street}, ${city}, ${state} ${zipCode}`,
        });
      }

      Alert.alert(
        "Success",
        isNew ? "Address added successfully." : "Address updated successfully.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Address save error:", error);
      Alert.alert("Error", "Unable to save address right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title={isNew ? "Add Address" : "Edit Address"} showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text className="text-primary text-sm mb-2">Label</Text>
        <View className="flex-row gap-2 mb-4">
          {LABEL_OPTIONS.map((l) => (
            <Pressable
              key={l}
              className={`px-4 py-2 rounded-xl ${label === l ? "bg-accent" : "bg-card"}`}
              onPress={() => setLabel(l)}
            >
              <Text
                className={
                  label === l
                    ? "text-white font-semibold"
                    : "text-text-secondary"
                }
              >
                {l}
              </Text>
            </Pressable>
          ))}
        </View>

        <InputField
          label="Street Address"
          value={street}
          onChangeText={setStreet}
          placeholder="e.g., 123 Rizal Street"
        />

        <InputField
          label="City"
          value={city}
          onChangeText={setCity}
          placeholder="e.g., Manila"
        />

        <InputField
          label="State/Province"
          value={state}
          onChangeText={setState}
          placeholder="e.g., Bulacan"
        />

        <InputField
          label="ZIP Code"
          value={zipCode}
          onChangeText={setZipCode}
          placeholder="e.g., 1234"
          keyboardType="number-pad"
        />

        <View className="gap-3 mt-2">
          <PrimaryButton
            label={isNew ? "Add Address" : "Save Changes"}
            fullWidth
            loading={saving}
            disabled={saving}
            onPress={handleSave}
          />
          <OutlinedButton label="Cancel" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
