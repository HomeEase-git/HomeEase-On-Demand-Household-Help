import React, { useEffect, useState } from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import ScreenHeader from "../../../../components/ui/ScreenHeader";
import InputField from "../../../../components/ui/InputField";
import UploadCard from "../../../../components/ui/UploadCard";
import PrimaryButton from "../../../../components/ui/PrimaryButton";
import ImageSourcePickerBottomSheet from "../../../../components/bottom-sheets/ImageSourcePickerBottomSheet";
import type { BottomSheetHandle } from "../../../../components/bottom-sheets/BottomSheetWrapper";
import * as api from "../../../../services/api";
import { useAlertModal } from "../../../../contexts/AlertModalContext";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Auto-inserts dashes as the user types digits, so "YYYY-MM-DD" doesn't have
// to be typed by hand and malformed input (e.g. "01/15/2024") can't happen.
function maskDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export default function UploadCertificationScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const { certId } = useLocalSearchParams<{ certId?: string }>();
  const isEditMode = !!certId;
  const sheetRef = React.useRef<BottomSheetHandle | null>(null);
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [documentUri, setDocumentUri] = useState<string | null>(null);
  const [existingDocumentUrl, setExistingDocumentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEditMode);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!certId) return;
    let cancelled = false;
    (async () => {
      try {
        const cert = await api.getCertificationDetail(certId);
        if (cancelled) return;
        setName(cert.name);
        setIssuer(cert.issuer);
        setIssueDate(cert.issueDate.slice(0, 10));
        setExpiryDate(cert.expiryDate ? cert.expiryDate.slice(0, 10) : "");
        setExistingDocumentUrl(cert.documentUrl);
      } catch (error) {
        console.error("Load certification error:", error);
        alertModal.error("Error", "Unable to load this certification.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certId]);

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
    if (!documentUri && !existingDocumentUrl) {
      alertModal.error("Error", "Please upload a document photo.");
      return;
    }

    setSaving(true);
    try {
      const documentUrl = documentUri
        ? (await api.uploadCertificationFile(documentUri)).url
        : (existingDocumentUrl ?? undefined);

      if (isEditMode && certId) {
        await api.updateCertification(certId, {
          name: name.trim(),
          issuer: issuer.trim(),
          issueDate: issueDate.trim(),
          expiryDate: expiryDate.trim() || null,
          documentUrl,
        });
        alertModal.success("Success", "Certification updated successfully.");
      } else {
        await api.addCertification({
          name: name.trim(),
          issuer: issuer.trim(),
          issueDate: issueDate.trim(),
          expiryDate: expiryDate.trim() || null,
          documentUrl: documentUrl as string,
        });
        alertModal.success("Success", "Certification uploaded successfully.");
      }
      router.back();
    } catch (error) {
      console.error("Save certification error:", error);
      alertModal.error(
        "Error",
        isEditMode
          ? "Failed to update certification. Please try again."
          : "Failed to upload certification. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title={isEditMode ? "Edit Certification" : "Upload Certification"} showBack />
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <InputField
          label="Certificate Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Plumbing License"
          editable={!loading}
        />
        <InputField
          label="Issuing Organization"
          value={issuer}
          onChangeText={setIssuer}
          placeholder="e.g. PRC, TESDA"
          editable={!loading}
        />
        <InputField
          label="Issue Date"
          value={issueDate}
          onChangeText={(text) => setIssueDate(maskDateInput(text))}
          placeholder="YYYY-MM-DD"
          keyboardType="number-pad"
          editable={!loading}
        />
        <InputField
          label="Expiry Date"
          value={expiryDate}
          onChangeText={(text) => setExpiryDate(maskDateInput(text))}
          placeholder="YYYY-MM-DD (leave blank if no expiry)"
          keyboardType="number-pad"
          editable={!loading}
        />
        <UploadCard
          label="Tap to upload document photo"
          onPress={() => sheetRef.current?.expand()}
          preview={
            documentUri
              ? "Document uploaded ✓"
              : existingDocumentUrl
                ? "Current document on file (tap to replace)"
                : null
          }
        />
        <View className="mt-4">
          <PrimaryButton
            label={isEditMode ? "Save Changes" : "Save Certification"}
            fullWidth
            onPress={handleSave}
            disabled={saving || loading}
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
