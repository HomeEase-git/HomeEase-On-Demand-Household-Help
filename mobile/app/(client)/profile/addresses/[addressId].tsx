import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon as Ionicons } from "../../../../components/icons/AppIcon";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import OutlinedButton from "../../../../components/ui/OutlinedButton";
import { colors, cardShadow } from "../../../../constants";
import { addressStorage } from "../../../../utils/storage";
import { geocodeAddress } from "../../../../utils/geo";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const LABEL_OPTIONS = ["Home", "Work", "Other"];

export default function AddressEditScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
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
      try {
        const addresses = await api.getAddresses();
        const existing = addresses.find((a: any) => a.id === addressId);
        if (existing) {
          setLabel(existing.label ?? "Home");
          setStreet(existing.street ?? "");
          setCity(existing.city ?? "");
          setState(existing.state ?? "");
          setZipCode(existing.zipCode ?? "");
        }
      } catch (error) {
        console.error("Load address error:", error);
      }
    };

    loadExisting();
  }, [addressId, isNew]);

  const handleSave = async () => {
    if (!street.trim() || !city.trim() || !state.trim() || !zipCode.trim()) {
      alertModal.error("Error", "Please fill in all address fields.");
      return;
    }

    setSaving(true);
    try {
      const fullAddress = `${street}, ${city}, ${state} ${zipCode}`;
      const geocoded = await geocodeAddress(fullAddress).catch(() => null);

      if (isNew) {
        const result = await api.addAddress({
          label,
          street,
          city,
          state,
          zipCode,
        });
        await addressStorage.upsert(result.id, {
          label,
          address: fullAddress,
          lat: geocoded?.geometry.location.lat,
          lng: geocoded?.geometry.location.lng,
        });
      } else if (addressId) {
        await api.updateAddress(addressId, {
          label,
          street,
          city,
          state,
          zipCode,
        });
        await addressStorage.upsert(addressId, {
          label,
          address: fullAddress,
          lat: geocoded?.geometry.location.lat,
          lng: geocoded?.geometry.location.lng,
        });
      }

      alertModal.success(
        "Success",
        isNew ? "Address added successfully." : "Address updated successfully.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (error) {
      console.error("Address save error:", error);
      alertModal.error("Error", "Unable to save address right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title={isNew ? "Add Address" : "Edit Address"} showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <View className="items-center mb-5">
          <View className="w-16 h-16 rounded-full bg-accent/10 items-center justify-center">
            <Ionicons name="location-outline" size={30} color={colors.accent.DEFAULT} />
          </View>
        </View>

        <View className="bg-card rounded-2xl p-4 mb-4" style={cardShadow}>
          <Text className="text-text-primary text-sm mb-2 font-semibold">Label</Text>
          <View className="flex-row gap-2">
            {LABEL_OPTIONS.map((l) => (
              <Pressable
                key={l}
                className={`px-4 py-2 rounded-xl ${label === l ? "bg-accent" : "bg-white"}`}
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
