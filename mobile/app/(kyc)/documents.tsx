import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import ScreenHeader from "../../components/ui/ScreenHeader";
import StepperHorizontal from "../../components/steppers/StepperHorizontal";
import { KYC_STEPS } from "../../constants";
import UploadCard from "../../components/ui/UploadCard";
import PrimaryButton from "../../components/ui/PrimaryButton";
import { useAuthStore } from "../../store/authStore";
import { submitKycDocument, uploadKycFile } from "../../services/api";
import { useMediaPicker, type PickedMedia } from "../../hooks/useMediaPicker";
import {
  documentRequirements,
  isDocumentTypeAllowed,
  type KycDocumentKey,
} from "../../utils/kycDocumentConfig";
import { useAlertModal } from "../../contexts/AlertModalContext";

// Worker-only screen: clearances + the health certificate. (Certifications
// are added later, when registering for a service.)
// Clients never reach this screen (selfie.tsx sends them straight
// to the contract), but we guard against direct navigation anyway.
const DOCUMENT_KEYS: KycDocumentKey[] = [
  "nbiClearance",
  "barangayClearance",
  "policeClearance",
  "cedula",
  "healthCertificate",
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
  healthCertificate: { uri: null, mimeType: null, name: null },
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
  const { pick } = useMediaPicker();
  // The picked file while it uploads, so the card can show it straight away.
  const [pending, setPending] = useState<(UploadedDocument & { key: KycDocumentKey }) | null>(null);

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

  const applyFile = async (key: KycDocumentKey, media: PickedMedia) => {
    if (!isDocumentTypeAllowed(key, media.originalMimeType)) {
      alertModal.error(
        "Invalid file type",
        `${documentRequirements[key].label} must be uploaded as a PDF or image file.`,
      );
      return;
    }

    const picked = { uri: media.uri, mimeType: media.mimeType, name: media.name };
    setPending({ key, ...picked });
    try {
      const { url } = await uploadKycFile(key, media.uri, media.mimeType);
      await submitKycDocument(key, url);
      setDocuments((prev) => ({ ...prev, [key]: picked }));
    } catch (error) {
      console.error("KYC document upload error", error);
      alertModal.error(
        "Upload failed",
        "We could not process that file. Please try again.",
      );
    } finally {
      setPending(null);
    }
  };

  const handleUpload = (key: KycDocumentKey) =>
    pick({
      title: documentRequirements[key].label,
      message: "Choose how you'd like to add this document.",
      sources: ["camera", "gallery", "files"],
      fileTypes: ["application/pdf", "image/*"],
      onPick: (media) => applyFile(key, media),
    });

  const renderUploadCard = (key: KycDocumentKey) => {
    const requirement = documentRequirements[key];
    const isPending = pending?.key === key;
    const shown = isPending ? pending : (documents[key] ?? emptyDocument);
    const isImage = !!shown.mimeType?.startsWith("image/");

    return (
      <View key={key} className="mb-3">
        <UploadCard
          label={requirement.label}
          subtitle={`${requirement.description} Accepted: ${requirement.accepts.join(", ")}`}
          required={requirement.required}
          imageUri={isImage ? shown.uri : null}
          preview={shown.uri ? shown.name || requirement.label : null}
          hint="Tap to choose a photo or PDF"
          uploading={isPending}
          onPress={() => handleUpload(key)}
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
          steps={KYC_STEPS.worker}
          currentStep={2}
        />
        <Text className="text-text-secondary text-sm mb-4">
          Upload your NBI clearance and a health certificate. The other clearances are optional. You&apos;ll add
          any certifications later, when you register for a service.
        </Text>

        <View className="mb-4">
          <Text className="text-text-primary font-semibold mb-2">Required</Text>
          {renderUploadCard("nbiClearance")}
          {renderUploadCard("healthCertificate")}
        </View>

        <View className="mb-4">
          <Text className="text-text-primary font-semibold mb-2">Optional</Text>
          {renderUploadCard("barangayClearance")}
          {renderUploadCard("policeClearance")}
          {renderUploadCard("cedula")}
        </View>

        <View className="mt-4">
          <PrimaryButton
            label="Continue"
            fullWidth
            disabled={
              missingRequired.length > 0 || pending !== null
            }
            loading={pending !== null}
            onPress={() => router.push("/(kyc)/resume")}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
