import React, { useState, useRef } from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import UploadCard from "../../../../components/ui/UploadCard";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function UploadCertificationScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const sheetRef = useRef<BottomSheetHandle | null>(null);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [documentUri, setDocumentUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSelect = (uri: string) => {
    setDocumentUri(uri);
  };

  const handleSave = async () => {
    if (!name.trim() || !issuer.trim()) {
      alertModal.error(
        "Error",
        "Please fill in the certificate name and issuing organization.",
      );
      return;
    }
    if (!DATE_PATTERN.test(issueDate.trim())) {
      alertModal.error("Error", "Please enter a valid issue date (YYYY-MM-DD).");
      return;
    }
    if (expiryDate.trim() && !DATE_PATTERN.test(expiryDate.trim())) {
      alertModal.error("Error", "Please enter a valid expiry date (YYYY-MM-DD).");
      return;
    }
    if (!documentUri) {
      alertModal.error("Error", "Please upload a document photo.");
      return;
    }

    setSaving(true);
    try {
      const { url } = await api.uploadCertificationFile(documentUri);
      await api.addCertification({
        name: name.trim(),
        issuer: issuer.trim(),
        issueDate: issueDate.trim(),
        expiryDate: expiryDate.trim() || null,
        documentUrl: url,
      });
      alertModal.success("Success", "Certification uploaded successfully.");
      router.back();
    } catch (error) {
      console.error("Upload certification error:", error);
      alertModal.error("Error", "Failed to upload certification. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Upload Certification" showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <InputField
          label="Certificate Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Plumbing License"
        />
        <InputField
          label="Issuing Organization"
          value={issuer}
          onChangeText={setIssuer}
          placeholder="e.g. PRC, TESDA"
        />
        <InputField
          label="Issue Date"
          value={issueDate}
          onChangeText={setIssueDate}
          placeholder="YYYY-MM-DD"
        />
        <InputField
          label="Expiry Date"
          value={expiryDate}
          onChangeText={setExpiryDate}
          placeholder="YYYY-MM-DD (leave blank if no expiry)"
        />
        <UploadCard
          label="Tap to upload document photo"
          onPress={() => sheetRef.current?.expand()}
          preview={documentUri ? "Document uploaded ✓" : null}
        />
        <View className="mt-4">
          <PrimaryButton
            label="Save Certification"
            fullWidth
            onPress={handleSave}
            disabled={saving}
            loading={saving}
          />
        </View>
      </ScrollView>
      <ImageSourcePickerBottomSheet
        innerRef={sheetRef}
        onSelect={handleSelect}
      />
    </SafeAreaView>
  );
}
