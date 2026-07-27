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
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const labelRef = useRef<TextInput>(null);

  useEffect(() => {
    const loadMethod = async () => {
      if (!methodId) return;
      try {
        const methods = await api.getPaymentMethods();
        const method = methods.find((m: any) => m.id === methodId);
        if (method?.label) setLabel(method.label);
      } catch (error) {
        console.error("Load payment method error:", error);
      } finally {
        setLoading(false);
      }
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
        await api.updatePaymentMethod(methodId, { label: label.trim() });
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
    <SafeAreaView className="flex-1 bg-white">
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
          disabled={saving || loading}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
