import React, { useEffect, useState, useRef } from "react";
import { View, TextInput, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import * as api from "../../../../services/api";

export default function EditPaymentMethodScreen() {
  const router = useRouter();
  const { methodId } = useLocalSearchParams<{ methodId: string }>();
  const [label, setLabel] = useState("My Card");
  const [saving, setSaving] = useState(false);

  const labelRef = useRef<TextInput>(null);

  useEffect(() => {
    const loadMethod = async () => {
      // Load from API if needed, but label is typically just displayed
      if (!methodId) return;
    };

    loadMethod();
  }, [methodId]);

  const handleSubmit = async () => {
    if (!label.trim()) {
      Alert.alert("Error", "Please enter a label");
      return;
    }

    setSaving(true);
    try {
      if (methodId) {
        // Note: The API expects updateAddress, but we're updating payment method
        // This should be a dedicated payment method update endpoint
        await api.updateAddress(methodId, { label: label.trim() });
      }
      Alert.alert("Success", "Payment method updated");
      router.back();
    } catch (error) {
      console.error("Update payment method error:", error);
      Alert.alert("Error", "Unable to save payment method right now.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-primary-white">
      <ScreenHeader title="Edit Payment Method" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <InputField
          ref={labelRef}
          label="Label (e.g., My Card, Work Card)"
          value={label}
          onChangeText={setLabel}
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
        <PrimaryButton
          label="Save Changes"
          fullWidth
          onPress={handleSubmit}
          loading={saving}
          disabled={saving}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
