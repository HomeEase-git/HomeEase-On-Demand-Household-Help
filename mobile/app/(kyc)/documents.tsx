import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import ScreenHeader from "../../components/ui/ScreenHeader";
import StepperHorizontal from "../../components/steppers/StepperHorizontal";
import UploadCard from "../../components/ui/UploadCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { useAuthStore } from "../../store/authStore";
import { submitKycDocument, uploadKycFile } from "../../services/api";
import {
  documentRequirements,
  isDocumentTypeAllowed,
  type KycDocumentKey,
} from "../../utils/kycDocumentConfig";
import { useAlertModal } from "../../contexts/AlertModalContext";

// Worker-only screen: clearances + optional certification.
// Clients never reach this screen (selfie.tsx sends them straight
// to the contract), but we guard against direct navigation anyway.
const DOCUMENT_KEYS: KycDocumentKey[] = [
  "nbiClearance",
  "barangayClearance",
  "policeClearance",
  "cedula",
  "certification",
];

type UploadedDocument = {
  uri: string | null;
  mimeType: string | null;
  name: string | null;
};

const initialDocuments: Partial<Record<KycDocumentKey, UploadedDocument>> = {
  nbiClearance: { uri: null, mimeType: null, name: null },
  barangayClearance: { uri: null, mimeType: null, name: null },
  policeClearance: { uri: null, mimeType: null, name: null },
  cedula: { uri: null, mimeType: null, name: null },
  certification: { uri: null, mimeType: null, name: null },
};

const emptyDocument: UploadedDocument = {
  uri: null,
  mimeType: null,
  name: null,
};

export default function DocumentsScreen() {
  const router = useRouter();
  const alertModal = useAlertModal();
  const user = useAuthStore((s) => s.user);
  const isWorker = user?.role === "worker";
  const [documents, setDocuments] = useState(initialDocuments);
  const [uploadingKey, setUploadingKey] = useState<KycDocumentKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isWorker) {
      router.replace("/(kyc)/contract");
    }
  }, [isWorker, router]);

  const missingRequired = useMemo(
    () =>
      DOCUMENT_KEYS.filter(
        (key) => documentRequirements[key].required && !documents[key]?.uri,
      ),
    [documents],
  );

  const handleUpload = async (key: KycDocumentKey) => {
    setUploadingKey(key);
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        alertModal.warning(
          "File access required",
          "Please allow photo access to choose a document file.",
        );
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const document = result.assets[0];
      if (!document?.uri) {
        return;
      }

      const mimeType = document.mimeType || "application/octet-stream";
      if (!isDocumentTypeAllowed(key, mimeType)) {
        alertModal.error(
          "Invalid file type",
          `${documentRequirements[key].label} must be uploaded as a PDF or image file.`,
        );
        return;
      }

      setSubmitting(true);
      const { url } = await uploadKycFile(key, document.uri, mimeType);
      await submitKycDocument(key, url);
      setDocuments((prev) => ({
        ...prev,
        [key]: {
          uri: document.uri,
          mimeType,
          name: document.name || `${key} document`,
        },
      }));
      alertModal.success(
        "Success",
        `${documentRequirements[key].label} uploaded successfully.`,
      );
    } catch (error) {
      console.error("KYC document upload error", error);
      alertModal.error(
        "Upload failed",
        "We could not process that file. Please try again.",
      );
    } finally {
      setSubmitting(false);
      setUploadingKey(null);
    }
  };

  const renderUploadCard = (key: KycDocumentKey) => {
    const requirement = documentRequirements[key];
    const uploaded = documents[key] ?? emptyDocument;
    const preview = uploaded.uri
      ? uploaded.name || requirement.label
      : undefined;

    return (
      <View key={key} className="mb-3">
        <UploadCard
          label={requirement.label}
          subtitle={`${requirement.description} Accepted: ${requirement.accepts.join(", ")}`}
          required={requirement.required}
          preview={preview}
          onPress={() => handleUpload(key)}
          disabled={uploadingKey === key || submitting}
        />
      </View>
    );
  };

  if (!isWorker) {
    return null;
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScreenHeader title="Clearances & Documents" showBack />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
      >
        <StepperHorizontal
          steps={["ID", "Selfie", "Documents", "Resume", "Contract"]}
          currentStep={2}
        />
        <Text className="text-text-secondary text-sm mb-4">
          Workers must upload their clearances below. Certification is optional
          but can strengthen your profile.
        </Text>

        <View className="mb-4">
          <Text className="text-primary font-semibold mb-2">Clearances</Text>
          {renderUploadCard("nbiClearance")}
          {renderUploadCard("barangayClearance")}
          {renderUploadCard("policeClearance")}
          {renderUploadCard("cedula")}
        </View>

        <View className="mb-4">
          <Text className="text-primary font-semibold mb-2">Optional</Text>
          {renderUploadCard("certification")}
        </View>

        <View className="mt-4">
          <PrimaryButton
            label="Continue"
            fullWidth
            disabled={
              missingRequired.length > 0 || uploadingKey !== null || submitting
            }
            loading={uploadingKey !== null || submitting}
            onPress={() => router.push("/(kyc)/resume")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
